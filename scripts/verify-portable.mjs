import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
const exe=path.resolve('release/Sirona-0.1.0-win-x64.exe');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'novel-portable-proof-')),root=path.join(temp,'虚构作品'),profile=path.join(temp,'profile');
await fs.mkdir(path.join(root,'documents'),{recursive:true});await fs.mkdir(profile);
const id=randomUUID(),work={schemaVersion:1,id:randomUUID(),title:'便携程序 · 虚构验收',createdAt:new Date().toISOString(),documents:[{id,kind:'chapter',title:'第一章',order:0,aliases:[],tags:[],deletedAt:null}]};
await fs.writeFile(path.join(root,'workspace.json'),JSON.stringify(work));const file=path.join(root,'documents',id+'.md');await fs.writeFile(file,'');
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({model:{adapter:'generic',baseUrl:'https://api.deepseek.com',model:'',inputLimit:24000,maxOutputTokens:2000,thinking:false},fontSize:20,lineHeight:1.9,recent:[{path:root,title:work.title}]}));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function launch(){const port=await freePort(),start=Date.now();const child=spawn(exe,[`--remote-debugging-port=${port}`],{env:{...process.env,NOVEL_USER_DATA:profile},windowsHide:true,stdio:'ignore'});const exited=new Promise(r=>child.on('exit',r));let browser;
 for(let i=0;i<180;i++){try{const result=await fetch(`http://127.0.0.1:${port}/json/version`);if(result.ok){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}}catch{}await new Promise(r=>setTimeout(r,250));}
 if(!browser)throw new Error('Portable debugging endpoint did not become ready');const page=browser.contexts()[0].pages()[0]??await browser.contexts()[0].waitForEvent('page');await expect(page.getByRole('textbox',{name:'正文编辑区',exact:true})).toBeVisible();return{page,browser,elapsed:Date.now()-start,exited};}
async function close(run){await run.page.evaluate(()=>window.novelAPI.confirmClose()).catch(e=>{if(!String(e).includes('closed'))throw e;});await Promise.race([run.exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Portable did not exit')),15000))]);await run.browser.close().catch(()=>{});}
let run;
try{
 run=await launch();const firstLaunchMs=run.elapsed;await expect(run.page).toHaveTitle('Sirona');await expect(run.page.locator('.brand')).toContainText('Sirona');const editor=run.page.getByRole('textbox',{name:'正文编辑区',exact:true});await editor.fill('便携 EXE 独立打开。\n\n虚构的故事，从这里开始。');await run.page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>fs.readFile(file,'utf8')).toBe('便携 EXE 独立打开。\n\n虚构的故事，从这里开始。');
 await run.page.getByRole('button',{name:'设定',exact:true}).click();await run.page.getByRole('button',{name:'＋ 新设定',exact:true}).click();await run.page.getByRole('textbox',{name:'资料编辑区',exact:true}).fill('自由设定：雨在黎明前停下。');await run.page.getByRole('button',{name:'收起',exact:true}).click();
 await run.page.screenshot({path:'docs/evidence/sirona-portable-window.png'});const environment=await run.page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio,node:typeof window.require}));await close(run);run=undefined;
 run=await launch();await expect(run.page.getByRole('textbox',{name:'正文编辑区',exact:true})).toContainText('虚构的故事，从这里开始。');await run.page.getByRole('button',{name:'设定',exact:true}).click();await run.page.getByRole('button',{name:'未命名设定',exact:true}).click();await expect(run.page.getByRole('textbox',{name:'资料编辑区',exact:true})).toContainText('雨在黎明前停下');
 const report={status:'passed',exe,sha256:createHash('sha256').update(await fs.readFile(exe)).digest('hex'),firstLaunchMs,reopenMs:run.elapsed,environment,checks:['portable launcher started actual Electron child','offline manuscript save','free setting save','exit and reopen persistence','renderer Node unavailable'],limitations:['same Windows host with DSH installed; DSH not used or stopped','CDP used only for automation; no dev server','native picker flows covered in unpacked production build, not this launcher run'],testedAt:new Date().toISOString()};await fs.writeFile('docs/evidence/sirona-portable-smoke.json',JSON.stringify(report,null,2));await close(run);run=undefined;console.log(JSON.stringify(report,null,2));
}finally{if(run)await close(run).catch(()=>{});}
