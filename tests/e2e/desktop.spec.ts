import { test,expect,_electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/main/workspace/store';
import { defaultModel } from '../../src/main/settings';
import http from 'node:http';
test('离线正文、自由资料、专注、重启持久化和隔离边界',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'novel-e2e-'));
 const store=new Store();await store.create(temp,'虚构作品 · 雨夜');
 const data=path.join(temp,'profile');await fs.mkdir(data);
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({model:defaultModel,fontSize:20,lineHeight:1.9,recent:[{path:store.root,title:store.work.title}]}));
 const launch=()=>electron.launch({executablePath:process.env.NOVEL_TEST_EXE||undefined,args:process.env.NOVEL_TEST_EXE?['--headless-test']:['.','--headless-test'],env:{...process.env,NOVEL_USER_DATA:data},timeout:20000});
 let app=await launch();let page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const body=page.getByRole('textbox',{name:'正文编辑区',exact:true});await expect(body).toBeVisible();
  await body.fill('夜雨落在窗前。\n\n她没有立刻回答。');
  await expect.poll(()=>fs.readFile(path.join(store.root,'documents',store.work.documents[0].id+'.md'),'utf8')).toBe('夜雨落在窗前。\n\n她没有立刻回答。');
  await page.getByRole('button',{name:'人物',exact:true}).click();await page.getByRole('button',{name:'＋ 新人物',exact:true}).click();
  await page.getByRole('textbox',{name:'资料编辑区',exact:true}).fill('她喜欢雨天。\n\n一句话也可以成为人物卡。');
  await page.getByRole('button',{name:'加入 AI 参考',exact:true}).click();
  await expect(page.locator('.references summary')).toContainText('已加入「未命名人物」');
  await expect(page.locator('.conversation')).toContainText('只有发送时才调用模型');
  await page.getByRole('button',{name:'专注',exact:true}).click();await expect(page.locator('.dock')).toHaveCount(0);
  await page.getByRole('button',{name:'AI 助手',exact:true}).click();await expect(page.locator('.dock')).toBeVisible();
  expect(await page.evaluate(()=>({node:typeof (window as any).require,process:typeof (window as any).process,api:typeof window.novelAPI.saveDocument}))).toEqual({node:'undefined',process:'undefined',api:'function'});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await page.screenshot({path:'docs/evidence/desktop-1280.png'});
  await fs.writeFile('docs/evidence/window-environment.json',JSON.stringify(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio})),null,2));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,720));await page.screenshot({path:'docs/evidence/desktop-1024.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>window.novelAPI.confirmClose()).catch(e=>{if(!String(e).includes('closed'))throw e;});await app.close();
  app=await launch();page=await app.firstWindow();await expect(page.getByRole('textbox',{name:'正文编辑区',exact:true})).toContainText('她没有立刻回答。');
  await page.getByRole('button',{name:'人物',exact:true}).click();await page.getByRole('button',{name:'未命名人物',exact:true}).click();await expect(page.getByRole('textbox',{name:'资料编辑区',exact:true})).toContainText('一句话也可以成为人物卡');
  expect(errors).toEqual([]);
 }finally{await app.evaluate(({app})=>app.exit()).catch(()=>{});await app.close().catch(()=>{});}
});
test('AI仅明确发送，原文不自动改变，采纳与单笔撤销',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'novel-ai-e2e-'));const store=new Store();await store.create(temp,'虚构AI验收');const data=path.join(temp,'profile');await fs.mkdir(data);
 await store.createDoc('setting', '港口', '下午退潮。');
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({model:defaultModel,fontSize:20,lineHeight:1.9,recent:[{path:store.root,title:store.work.title}]}));
 let requests=0;
 let respond: (()=>void) | undefined;
 const server=http.createServer((req,res)=>{
  requests++;
  req.resume();
  req.on('end',()=>{
   respond=()=>{
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end('data: {"choices":[{"delta":{"content":"窗外的雨渐渐停了。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
   };
  });
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as any).port;const app=await electron.launch({args:['.','--headless-test'],env:{...process.env,NOVEL_USER_DATA:data}});const page=await app.firstWindow();
 try{
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].showInactive());
  const editor=page.getByRole('textbox',{name:'正文编辑区',exact:true});await expect(editor).toBeVisible();await editor.fill('原有的正文。');await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('footer > span').first()).toHaveText('已保存');
  await page.evaluate(async({port,model})=>{await window.novelAPI.settings({model:{...model,baseUrl:`http://127.0.0.1:${port}/v1`,model:'mock'},key:'FAKE_E2E_ONLY'});},{port,model:defaultModel});
  await page.getByRole('button',{name:'AI 助手',exact:true}).click();expect(requests).toBe(0);
  await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
  await page.locator('.library nav').getByRole('button', {name: '设定', exact: true}).click();
  await page.locator('.library').getByRole('button', {name: '港口', exact: true}).click();
  await page.getByRole('button', {name: '加入 AI 参考', exact: true}).click();
  const referenceSummary = page.locator('.references summary');
  await expect(referenceSummary).toContainText('已加入「港口」');
  expect(requests).toBe(0);
  await referenceSummary.click();
  await expect(page.getByRole('checkbox', {name: '港口', exact: true})).toBeChecked();
  await referenceSummary.click();
  const prompt=page.getByRole('textbox',{name:'想让 AI 帮什么'});await prompt.fill('接着写一句');await prompt.press('Enter');expect(requests).toBe(0);await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.composer').getByRole('status')).toHaveText('等待模型回复…');
  await expect(page.getByRole('button', {name: '停止', exact: true})).toHaveCount(1);
  await expect.poll(()=>Boolean(respond)).toBe(true);
  respond!();
  await expect(page.locator('.assistant-message')).toHaveText('窗外的雨渐渐停了。');await expect(page.getByRole('button',{name:'插入正文',exact:true})).toBeVisible();expect(requests).toBe(1);await expect(editor).toHaveText('原有的正文。');
  await page.getByRole('button',{name:'插入正文',exact:true}).click();await page.getByRole('button',{name:'采纳',exact:true}).click();await expect(editor).toContainText('窗外的雨渐渐停了。');
  await expect(editor.locator('.cm-ai-applied')).toHaveText('窗外的雨渐渐停了。');
  await expect(editor.locator('.cm-ai-applied')).toHaveCount(0);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(editor).toHaveText('原有的正文。');
  await editor.press('Control+s');
  await expect(page.locator('footer > span').first()).toHaveText('已保存');
  const history=await page.evaluate(async()=>{const b=await window.novelAPI.boot();return window.novelAPI.history(b.workspace!.documents[0].id);});expect(history.some(h=>h.reason==='AI 采纳前'&&h.content==='原有的正文。')).toBe(true);
  await page.screenshot({path:'docs/evidence/ai-manual-adoption.png'});
 }finally{await app.evaluate(({app})=>app.exit()).catch(()=>{});await app.close().catch(()=>{});server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('窄窗口的按钮响应即时，键盘快切页签和菜单可继续操作', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sirona-motion-'));
  const store = new Store();
  await store.create(dir, '临时动效验收');
  const profile = path.join(dir, 'profile');
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    model: defaultModel, fontSize: 20, lineHeight: 1.9,
    recent: [{path: store.root, title: store.work.title}]
  }));
  const app = await electron.launch({
    args: ['.', '--headless-test'], env: {...process.env, NOVEL_USER_DATA: profile}
  });
  try {
    const page = await app.firstWindow();
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await app.evaluate(({BrowserWindow}) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(1024, 720);
      window.showInactive();
    });
    const search = page.getByRole('button', {name: '搜索作品', exact: true});
    const box = await search.boundingBox();
    if (!box) throw new Error('搜索按钮不可见');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(search).toHaveCSS('background-color', 'rgb(41, 43, 46)');
    await page.mouse.down();
    await expect(search).toHaveCSS('background-color', 'rgb(34, 36, 39)');
    expect(await search.boundingBox()).toEqual(box);
    await page.mouse.move(0, 0);
    await page.mouse.up();

    const tabs = page.getByRole('navigation', {name: '作品内容'});
    const characters = tabs.getByRole('button', {name: '人物', exact: true});
    await characters.press('Enter');
    await tabs.getByRole('button', {name: '设定', exact: true}).press('Enter');
    await characters.press('Enter');
    await expect(characters).toHaveAttribute('aria-pressed', 'true');
    const marker = tabs.locator('.library-tab-marker');
    await expect.poll(async () => Math.abs((await marker.boundingBox())!.x - (await characters.boundingBox())!.x)).toBeLessThan(1);

    await tabs.getByRole('button', {name: '正文', exact: true}).press('Enter');
    const action = page.getByRole('button', {name: '第一章的操作', exact: true});
    await action.press('Enter');
    const menu = page.locator('.library-actions:popover-open');
    await expect(menu).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(action).toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('button', {name: 'AI 助手', exact: true}).press('Enter');
    await expect(page.locator('.dock')).toBeVisible();
    await expect(page.getByRole('textbox', {name: '正文编辑区', exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await app.evaluate(({app})=>app.exit()).catch(()=>{});
    await app.close().catch(()=>{});
  }
});
