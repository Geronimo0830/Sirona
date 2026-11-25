import { app, BrowserWindow, ipcMain, dialog, protocol, safeStorage, shell } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Store } from './workspace/store';
import { atomic, exists, validId } from './workspace/files';
import { SettingsStore } from './settings';
import { AiService, endpoint, prepare } from './ai';
import { backupWork, importWork, scan } from './migration';
import type { ImportPlan, NovelAPI, Result } from '../shared/types';
protocol.registerSchemesAsPrivileged([{ scheme: 'novel', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if(process.env.NOVEL_USER_DATA)app.setPath('userData',path.resolve(process.env.NOVEL_USER_DATA));
const lock=app.requestSingleInstanceLock();if(!lock)app.quit();
let win:BrowserWindow;let closing=false;const store=new Store();let lastPlan:ImportPlan|undefined;
const id=z.uuid();const text=z.string().max(20_000_000);const refs=z.object({ids:z.array(id).max(500),mode:z.enum(['chapter','selection','none']),includeHistory:z.boolean()});
const documentKind = z.enum(['chapter', 'character', 'setting']);
const groupTitle = z.string().trim().max(500);
const moveDirection = z.number().int().min(-1).max(1).optional();
const save=z.object({workspaceId:id,docId:id,editorSessionId:id,revision:z.number().int().nonnegative(),baseHash:z.string().regex(/^[a-f0-9]{64}$/),text});
const selection=z.object({from:z.number().int().nonnegative(),to:z.number().int().nonnegative(),text});
const aiInput=z.object({docId:id,sessionId:id,revision:z.number().int().nonnegative(),hash:z.string().regex(/^[a-f0-9]{64}$/),insertionPosition:z.number().int().nonnegative(),selection:selection.optional(),refs,prompt:z.string().trim().min(1).max(200000)});
const model=z.object({adapter:z.enum(['generic','deepseek']),baseUrl:z.string().max(2048),model:z.string().max(200),inputLimit:z.number().int().min(4000).max(200000),maxOutputTokens:z.number().int().min(256).max(8192),thinking:z.boolean()});
const configPatch=z.object({model:model.optional(),fontSize:z.number().min(16).max(28).optional(),lineHeight:z.number().min(1.6).max(2.2).optional(),key:z.string().max(4096).optional(),clearKey:z.boolean().optional()});
const viewSchema=z.object({chapterId:id.optional(),positions:z.record(id,z.object({anchor:z.number().int().nonnegative(),scroll:z.number().nonnegative()})).optional(),left:z.boolean().optional(),dock:z.string().nullable().optional()});
const statePatch=z.object({view:viewSchema.optional(),refs:z.record(id,refs).optional(),preferences:z.string().max(200000).optional()});
async function pickFolder(title:string){const result=await dialog.showOpenDialog(win,{title,properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];}
app.on('second-instance',()=>{if(win){win.show();win.focus();}});
if(lock)void app.whenReady().then(async()=>{
  const settings=new SettingsStore(app.getPath('userData'),{available:()=>safeStorage.isAsyncEncryptionAvailable(),encrypt:v=>safeStorage.encryptStringAsync(v),decrypt:async b=>(await safeStorage.decryptStringAsync(b)).result});
  const ai=new AiService(store,settings,record=>{if(!win.isDestroyed())win.webContents.send('novel:ai',record);});
  const assertIdle=()=>{if(ai.busy)throw new Error('请先停止正在生成的回复');};
  const remember=()=>settings.recent(store.root,store.work.title);
  const methods:Record<string,(...args:any[])=>Promise<unknown>>={
    boot:async()=>{await settings.load();let error:string|undefined;let view;const recent=settings.public().recent[0];if(recent&&!store.root){try{await store.open(recent.path);view=(await store.state()).view;}catch(e){error=e instanceof Error?e.message:'上次作品无法打开';}}return{settings:settings.public(),workspace:store.root?store.work:undefined,view,error};},
    createWorkspace:async title=>{assertIdle();const name=z.string().max(100).parse(title);const parent=await pickFolder('选择新作品的保存位置');if(!parent)return null;const work=await store.create(parent,name);await remember();return work;},
    openWorkspace:async recentPath=>{assertIdle();let root:string|null;if(recentPath!==undefined){root=z.string().parse(recentPath);if(!settings.public().recent.some(r=>r.path===root))throw new Error('请通过文件夹选择器打开该作品');}else root=await pickFolder('打开作品目录');if(!root)return null;if(await exists(path.join(root,'IMPORT_FAILED.txt'))||await exists(path.join(root,'BACKUP_INCOMPLETE.txt')))throw new Error('这是未完成的导入或备份副本，请从完好的原作品重试');const work=await store.open(root);await remember();return work;},
    renameWorkspace:async title=>{const value=z.string().max(100).parse(title);const work=await store.mutate(async w=>{w.title=value.trim()||'未命名作品';});await remember();return work;},
    loadDocument:async docId=>store.load(id.parse(docId)),
    saveDocument:async input=>store.save(save.parse(input)),
    createDocument:async (kind,groupId)=>store.createDoc(documentKind.parse(kind),'','',id.nullable().optional().parse(groupId)),
    updateDocument:async(docId,patch,direction)=>store.updateDoc(id.parse(docId),z.object({title:z.string().max(500).optional(),aliases:z.array(z.string().max(200)).max(100).optional(),tags:z.array(z.string().max(200)).max(100).optional(),deletedAt:z.string().datetime().nullable().optional(),groupId:id.nullable().optional()}).strict().parse(patch),moveDirection.parse(direction)),
    createGroup:async(kind,title)=>store.createGroup(documentKind.parse(kind),groupTitle.parse(title)),
    updateGroup:async(groupId,patch)=>store.updateGroup(id.parse(groupId),z.object({title:groupTitle.optional(),direction:moveDirection}).strict().parse(patch)),
    dissolveGroup:async groupId=>store.dissolveGroup(id.parse(groupId)),
    history:async docId=>store.history(id.parse(docId)),
    checkpoint:async(input,reason)=>store.checkpoint(save.parse(input),z.enum(['AI 采纳前']).parse(reason)),
    restore:async(docId,snapId)=>store.restore(id.parse(docId),id.parse(snapId)),
    recoveryCopy:async(docId,content)=>{const doc=store.meta(id.parse(docId));const data=text.parse(content);const result=await dialog.showSaveDialog(win,{title:'另存未保存的内容',defaultPath:(doc.title||'恢复副本')+'.txt',filters:[{name:'文本',extensions:['txt']}]});if(result.canceled||!result.filePath)return null;if(await exists(result.filePath))throw new Error('为保护已有文件，请选择新的副本名称');await fs.writeFile(result.filePath,data,{encoding:'utf8',flag:'wx'});return result.filePath;},
    reloadDocument:async(docId,content)=>store.reload(id.parse(docId),text.parse(content)),
    search:async query=>store.search(z.string().max(1000).parse(query)),
    readState:async()=>store.state(),saveState:async patch=>store.saveState(statePatch.parse(patch)),
    settings:async patch=>{await settings.load();if(patch===undefined)return settings.public();const parsed=configPatch.parse(patch);if(parsed.model)endpoint(parsed.model.baseUrl,'chat/completions');return settings.save(parsed);},
    models:async()=>{await settings.load();const current=settings.public();const res=await fetch(endpoint(current.model.baseUrl,'models'),{headers:{Authorization:`Bearer ${settings.secret()}`},signal:AbortSignal.timeout(15000),redirect:'error'});if(!res.ok)throw new Error('无法读取模型列表（'+res.status+'），可以直接填写模型名');const data=await res.json() as {data?:{id:string}[]};return(data.data??[]).map(x=>x.id).filter(x=>typeof x==='string');},
    chats:async docId=>{const records=await store.chats(id.parse(docId));return records.map(r=>(r.status==='streaming'||r.status==='connecting')&&!ai.busy?{...r,status:'stopped',error:'上次请求已中断，没有自动重发'}:r);},
    previewAi:async input=>prepare(store,aiInput.parse(input),settings.public().model),
    startAi:async input=>ai.start(aiInput.parse(input)),stopAi:async()=>ai.stop(),
    exportText:async()=>{assertIdle();await store.drain();const result=await dialog.showSaveDialog(win,{title:'导出正文',defaultPath:store.work.title+'.txt',filters:[{name:'正文文本',extensions:['txt']}]});if(result.canceled||!result.filePath)return null;if(await exists(result.filePath))throw new Error('文件已存在，请选择新的导出名称');await fs.writeFile(result.filePath,await store.manuscriptText(),{encoding:'utf8',flag:'wx'});return result.filePath;},
    backup:async()=>{assertIdle();const parent=await pickFolder('选择作品之外的备份位置');return parent?backupWork(store,parent):null;},
    scanImport:async()=>{assertIdle();const source=await pickFolder('选择旧 DSH 作品目录（只读）');if(!source)return null;lastPlan=await scan(source);return structuredClone(lastPlan);},
    runImport:async plan=>{assertIdle();if(!lastPlan)throw new Error('请先扫描旧作品');const ordered=z.object({source:z.string(),entries:z.array(z.object({path:z.string()}))}).parse(plan);if(ordered.source!==lastPlan.source||ordered.entries.length!==lastPlan.entries.length||new Set(ordered.entries.map(e=>e.path)).size!==lastPlan.entries.length)throw new Error('导入清单已失效');const entries=ordered.entries.map(e=>{const found=lastPlan!.entries.find(x=>x.path===e.path);if(!found)throw new Error('导入条目无效');return found;});const parent=await pickFolder('选择新作品的保存位置');if(!parent)return null;const report=await importWork({...lastPlan,entries},parent);lastPlan=undefined;if(report.status!=='failed'){await store.open(report.target);await remember();}return report;},
    confirmClose:async()=>{assertIdle();await store.drain();closing=true;win.close();}
  };
  ipcMain.handle('novel:rpc',async(event,name:unknown,args:unknown):Promise<Result<unknown>>=>{
    try{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith('novel://app/'))throw new Error('不允许的界面请求');if(typeof name!=='string'||!Object.hasOwn(methods,name)||!Array.isArray(args)||args.length>3)throw new Error('未知操作');return{ok:true,value:await methods[name](...args)};}catch(error){return{ok:false,error:error instanceof z.ZodError?'输入参数无效':error instanceof Error?error.message:'操作失败'};}
  });
  const renderer=path.join(__dirname,'renderer');
  protocol.handle('novel',async req=>{const url=new URL(req.url);if(url.hostname!=='app')return new Response('Forbidden',{status:403});const relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';const file=path.resolve(renderer,relative);if(!file.startsWith(renderer+path.sep))return new Response('Forbidden',{status:403});try{const data=await fs.readFile(file);const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};return new Response(new Uint8Array(data),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}});
  win=new BrowserWindow({width:1280,height:800,minWidth:1024,minHeight:720,show:!process.argv.includes('--headless-test'),backgroundColor:'#101112',title:'Sirona',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
  win.on('close',event=>{if(!closing){event.preventDefault();win.webContents.send('novel:close');}});
  await win.loadURL('novel://app/index.html');
}).catch(error=>{dialog.showErrorBox('无法启动 Sirona',error instanceof Error?error.message:'启动失败');app.quit();});
app.on('window-all-closed',()=>app.quit());
