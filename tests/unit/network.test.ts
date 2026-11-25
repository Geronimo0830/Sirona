import {it,expect} from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../../src/main/workspace/store';
import {SettingsStore,defaultModel} from '../../src/main/settings';
import {AiService} from '../../src/main/ai';
import type {AiInput,ChatRecord} from '../../src/shared/types';
async function scenario(handler:(req:http.IncomingMessage,res:http.ServerResponse)=>void,timing?:{first:number;total:number}){
 const server=http.createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as any).port;const dir=await fs.mkdtemp(path.join(os.tmpdir(),'novel-net-'));const store=new Store();await store.create(dir,'虚构网络测试');const d=await store.load(store.work.documents[0].id);
 const settings=new SettingsStore(path.join(dir,'settings'),{available:async()=>false,encrypt:async()=>Buffer.alloc(0),decrypt:async()=>''});await settings.save({key:'FAKE_TEST_KEY',model:{...defaultModel,adapter:'deepseek',model:'mock',baseUrl:`http://127.0.0.1:${port}/v1`}});
 const events:ChatRecord[]=[];let resolve!:(r:ChatRecord)=>void;const final=new Promise<ChatRecord>(r=>resolve=r);const service=new AiService(store,settings,r=>{events.push(r);if(['completed','failed','stopped'].includes(r.status))resolve(r);},timing);
 const input:AiInput={docId:d.docId,sessionId:d.editorSessionId,revision:d.revision,hash:d.hash,insertionPosition:0,refs:{ids:[],mode:'chapter',includeHistory:false},prompt:'虚构测试请求'};
 return{service,input,events,final,store,close:async()=>{await service.stop();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
it('真实回环HTTP：中文流、正文隔离、usage、单请求、原章绑定',async()=>{
 let count=0,body:any;const s=await scenario((req,res)=>{count++;let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{body=JSON.parse(raw);res.writeHead(200,{'Content-Type':'text/event-stream'});const bytes=Buffer.from('data: {"choices":[{"delta":{"content":"雨夜😀","reasoning_content":"隐藏思考"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":17}}\n\ndata: [DONE]\n\n');for(let i=0;i<bytes.length;i+=3)res.write(bytes.subarray(i,i+3));res.end();});});
 try{const start=s.service.start(s.input);await expect(s.service.start(s.input)).rejects.toThrow('已有');await start;const other=await s.store.createDoc('chapter','第二章','未被修改');const r=await s.final;expect(r.status).toBe('completed');expect(r.text).toBe('雨夜😀');expect(r.usage?.total_tokens).toBe(17);expect(body.thinking).toEqual({type:'disabled'});expect(body.max_tokens).toBe(2000);expect(count).toBe(1);expect((await s.store.chats(s.input.docId))[0].docId).toBe(s.input.docId);expect(await s.store.text(other.id)).toBe('未被修改');expect(await s.store.text(s.input.docId)).toBe('');}finally{await s.close();}
});
it('停止取消底层连接，保留部分回复并拒收迟到内容',async()=>{
 let disconnected=false;const s=await scenario((_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"已收到"}}]}\n\n');res.on('close',()=>{disconnected=true;});});
 try{await s.service.start(s.input);await expect.poll(()=>s.events.some(r=>r.text==='已收到')).toBe(true);await s.service.stop();expect((await s.final).status).toBe('stopped');expect((await s.final).text).toBe('已收到');await expect.poll(()=>disconnected).toBe(true);}finally{await s.close();}
});
it.each([401,429,500])('HTTP %s 不重试且本地编辑仍可用',async code=>{let count=0;const s=await scenario((_req,res)=>{count++;res.writeHead(code);res.end('error');});try{await s.service.start(s.input);expect((await s.final).status).toBe('failed');expect(count).toBe(1);const doc=await s.store.load(s.input.docId);await s.store.save({...doc,baseHash:doc.hash,revision:1,text:'离线仍可写'});expect(await s.store.text(doc.docId)).toBe('离线仍可写');}finally{await s.close();}});
it('首响应超时取消请求且不重试（测试缩短计时）',async()=>{let count=0;const s=await scenario(()=>{count++;},{first:60,total:200});try{await s.service.start(s.input);const r=await s.final;expect(r.status).toBe('failed');expect(r.error).toContain('超时');expect(count).toBe(1);}finally{await s.close();}});
it.each(['empty','truncated','broken'])('空回复/长度截断/断流保留已收文字：%s',async mode=>{const s=await scenario((_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(mode==='empty'?'data: [DONE]\n\n':mode==='truncated'?'data: {"choices":[{"delta":{"content":"半段"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n':'data: {"choices":[{"delta":{"content":"半段"}}]}\n\n');});try{await s.service.start(s.input);const r=await s.final;expect(r.status).toBe('failed');expect(r.text).toBe(mode==='empty'?'':'半段');expect(r.usage).toBeUndefined();}finally{await s.close();}});
