import { test,expect,_electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../../src/main/workspace/store';
import {defaultModel} from '../../src/main/settings';
test('外部冲突阻止切章，重载归档缓冲；组合输入期间不保存',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'novel-protect-'));const store=new Store();await store.create(temp,'虚构保护验收');await store.createDoc('chapter','第二章','二章内容');const file=await store.file(`documents/${store.work.documents[0].id}.md`);const data=path.join(temp,'profile');await fs.mkdir(data);await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({model:defaultModel,fontSize:20,lineHeight:1.9,recent:[{path:store.root,title:store.work.title}]}));
 const app=await electron.launch({args:['.','--headless-test'],env:{...process.env,NOVEL_USER_DATA:data}});const page=await app.firstWindow();
 try{
  const editor=page.getByRole('textbox',{name:'正文编辑区',exact:true});await expect(editor).toBeVisible();
  await editor.dispatchEvent('compositionstart');await editor.fill('组合输入中的文字');await page.waitForTimeout(900);expect(await fs.readFile(file,'utf8')).toBe('');await editor.dispatchEvent('compositionend');await expect.poll(()=>fs.readFile(file,'utf8')).toBe('组合输入中的文字');
  await fs.writeFile(file,'外部修改的版本');await editor.fill('尚未保存的新想法');await expect(page.locator('footer')).toContainText('保存失败');await page.getByRole('button',{name:'第二章',exact:true}).click();await expect(page.getByRole('dialog',{name:'内容尚未保存'})).toBeVisible();await page.getByRole('button',{name:'取消离开',exact:true}).click();await expect(editor).toHaveText('尚未保存的新想法');expect(await fs.readFile(file,'utf8')).toBe('外部修改的版本');
  await page.getByRole('button',{name:'第二章',exact:true}).click();await page.getByRole('button',{name:'重新载入',exact:true}).click();await expect(editor).toHaveText('二章内容');const history=await store.history(store.work.documents[0].id);expect(history.some(s=>s.reason==='重新载入前的未保存恢复副本'&&s.content==='尚未保存的新想法')).toBe(true);
 }finally{await app.evaluate(({app})=>app.exit()).catch(()=>{});await app.close().catch(()=>{});}
});
