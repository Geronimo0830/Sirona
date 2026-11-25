import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { ImportEntry, ImportPlan, ImportReport, Kind } from '../../shared/types';
import { atomic, hash, newDirectory, separate, uuid, writeJson } from '../workspace/files';
import { Store } from '../workspace/store';
export async function scan(source: string): Promise<ImportPlan> {
  source = await fs.realpath(source); const entries: ImportEntry[] = [];
  async function walk(dir: string) {
    for(const e of await fs.readdir(dir,{withFileTypes:true})) {
      const file=path.join(dir,e.name), relative=path.relative(source,file).replaceAll('\\','/'); const stat=await fs.lstat(file);
      if(stat.isSymbolicLink()){entries.push({path:relative,bytes:0,hash:'',issue:'符号链接/目录联接未导入'});continue;}
      if(e.isDirectory()){await walk(file);continue;} if(!e.isFile()) { entries.push({path:relative,bytes:0,hash:'',issue:'不支持的文件类型'});continue; }
      const bytes=await fs.readFile(file); const group=relative.split('/')[0]; let kind:Kind|undefined;
      if(/^(正文|章节|chapters?)$/i.test(group)&&/\.(txt|md)$/i.test(e.name))kind='chapter';
      if(group==='人物'&&/\.(json|txt|md)$/i.test(e.name))kind='character';
      if(group==='设定'&&/\.(txt|md)$/i.test(e.name))kind='setting';
      if(relative==='大纲.md')kind='setting';
      entries.push({path:relative,bytes:bytes.length,hash:hash(bytes),kind,title:e.name.replace(/\.[^.]+$/,'')});
    }
  }
  await walk(source);
  entries.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true}));return{source,entries};
}
function fingerprint(plan:ImportPlan){return JSON.stringify(plan.entries.map(e=>[e.path,e.hash,e.bytes]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
export async function importWork(plan:ImportPlan,parent:string):Promise<ImportReport>{
  const source=await fs.realpath(plan.source), parentReal=await fs.realpath(parent);
  const probe=path.join(parentReal,`${path.basename(source)}-导入`);separate(source,probe);
  const fresh=await scan(source);if(fingerprint(fresh)!==fingerprint(plan))throw new Error('来源在预览后发生变化，请重新扫描');
  const target=await newDirectory(parentReal,`${path.basename(source)}-导入`);separate(source,target);
  const id=uuid(), report:ImportReport={id,status:'failed',target,entries:structuredClone(plan.entries)};
  const archive=path.join(target,'.studio','imports',id,'original');
  try{
    for(const e of report.entries){if(!e.hash)continue;const from=path.join(source,e.path),to=path.join(archive,e.path);const bytes=await fs.readFile(from);if(hash(bytes)!==e.hash)throw new Error('来源发生变化：'+e.path);await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes,{flag:'wx'});if(hash(await fs.readFile(to))!==e.hash)throw new Error('归档校验失败：'+e.path);}
    if(fingerprint(await scan(source))!==fingerprint(plan))throw new Error('复制期间来源发生变化');
    const work={schemaVersion:1 as const,id:uuid(),title:path.basename(source),createdAt:new Date().toISOString(),documents:[]};
    await writeJson(path.join(target,'workspace.json'),work);const store=new Store();await store.open(target);
    for(const e of report.entries){if(!e.kind||!e.hash)continue;try{
      const bytes=await fs.readFile(path.join(archive,e.path));let content=new TextDecoder('utf-8',{fatal:true}).decode(bytes),title=e.title||'';
      if(e.kind==='character'&&e.path.toLowerCase().endsWith('.json')){
        const raw:unknown=JSON.parse(content);
        if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('人物 JSON 应为对象');
        const obj=raw as Record<string,unknown>;if(typeof obj['姓名']==='string')title=obj['姓名'];else if(typeof obj.name==='string')title=obj.name;
        content=Object.entries(obj).map(([k,v])=>`${k}：${typeof v==='string'?v:JSON.stringify(v,null,2)}`).join('\n\n');
      }
      const doc=await store.createDoc(e.kind,title,content);e.docId=doc.id;
    }catch(error){e.issue='未转换：'+(error instanceof Error?error.message:'无法读取');}}
    if(fingerprint(await scan(source))!==fingerprint(plan))throw new Error('转换期间来源发生变化');
    report.status=report.entries.some(e=>e.issue)?'partial':'verified';
  }catch(error){report.error=error instanceof Error?error.message:'导入失败';report.status='failed';}
  await writeJson(path.join(target,'.studio','imports',id,'report.json'),report);
  // A failed conversion workspace is kept as an incomplete recovery directory, never opened automatically.
  if(report.status==='failed')await atomic(path.join(target,'IMPORT_FAILED.txt'),report.error||'导入未完成，请勿当作正式作品打开');
  return report;
}
export async function backupWork(store:Store,parent:string){
  const source=await fs.realpath(store.root),realParent=await fs.realpath(parent);separate(source,path.join(realParent,path.basename(source)+'-备份'));
  await store.drain();store.locked=true;
  try{
    const before=await scan(source);if(before.entries.some(e=>!e.hash))throw new Error('作品内包含链接或不支持的文件，请先处理后备份');
    const target=await newDirectory(realParent,path.basename(source)+'-备份');
    try{for(const e of before.entries){const bytes=await fs.readFile(path.join(source,e.path));if(hash(bytes)!==e.hash)throw new Error('备份期间来源发生变化');const to=path.join(target,e.path);await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes,{flag:'wx'});if(hash(await fs.readFile(to))!==e.hash)throw new Error('备份校验失败');}
      if(fingerprint(await scan(source))!==fingerprint(before))throw new Error('备份期间来源发生外部变化');return target;
    }catch(error){await atomic(path.join(target,'BACKUP_INCOMPLETE.txt'),'备份未完成，请保留原作品。');throw error;}
  }finally{store.locked=false;}
}
