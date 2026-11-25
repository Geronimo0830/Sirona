import {test,expect,_electron as electron} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('新作品、旧作品复制导入、TXT导出和全量备份',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'novel-files-'));const legacy=path.join(temp,'虚构旧作品');await fs.mkdir(path.join(legacy,'正文'),{recursive:true});await fs.mkdir(path.join(legacy,'人物'));await fs.writeFile(path.join(legacy,'正文','01.md'),'旧稿正文。');await fs.writeFile(path.join(legacy,'人物','人.json'),JSON.stringify({name:'虚构人',extra:['自由','内容']}));
 const app=await electron.launch({executablePath:process.env.NOVEL_TEST_EXE||undefined,args:process.env.NOVEL_TEST_EXE?['--headless-test']:['.','--headless-test'],env:{...process.env,NOVEL_USER_DATA:path.join(temp,'profile')}});const page=await app.firstWindow();
 const choose=async(file:string)=>app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
 try{
  await expect(page.getByRole('heading',{name:'把故事写下来。'})).toBeVisible();await choose(temp);const created=await page.evaluate(()=>window.novelAPI.createWorkspace('虚构新作品'));expect(created!.documents).toHaveLength(1);expect(created!.documents[0].kind).toBe('chapter');
  await choose(legacy);const plan=await page.evaluate(()=>window.novelAPI.scanImport());await choose(temp);const report=await page.evaluate(plan=>window.novelAPI.runImport(plan!),plan);expect(report?.status).toBe('verified');const boot=await page.evaluate(()=>window.novelAPI.boot());expect(boot.workspace!.documents).toHaveLength(2);
  const outfile=path.join(temp,'正文导出.txt');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},outfile);await page.evaluate(()=>window.novelAPI.exportText());const exported=await fs.readFile(outfile,'utf8');expect(exported).toContain('旧稿正文。');expect(exported).not.toContain('extra');
  await choose(temp);const backup=await page.evaluate(()=>window.novelAPI.backup());expect(await fs.readFile(path.join(backup!,'workspace.json'),'utf8')).toBe(await fs.readFile(path.join(report!.target,'workspace.json'),'utf8'));expect(await fs.readFile(path.join(legacy,'正文','01.md'),'utf8')).toBe('旧稿正文。');
  await fs.mkdir('docs/evidence',{recursive:true});
  await fs.writeFile('docs/evidence/file-flows.json',JSON.stringify({mode:process.env.NOVEL_TEST_EXE?'packaged':'development',create:true,import:report!.status,export:true,backup:true,sourceUnchanged:true},null,2));
 }finally{await app.evaluate(({app})=>app.exit()).catch(()=>{});await app.close().catch(()=>{});}
});
