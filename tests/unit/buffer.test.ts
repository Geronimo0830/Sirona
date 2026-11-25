import {it,expect,vi,afterEach} from 'vitest';
import {DocumentBuffer} from '../../src/renderer/editor';
import {hash,uuid} from '../../src/main/workspace/files';
import type {LoadedDoc,SaveInput} from '../../src/shared/types';
afterEach(()=>vi.unstubAllGlobals());
const loaded=():LoadedDoc=>({workspaceId:uuid(),docId:uuid(),editorSessionId:uuid(),revision:0,hash:hash(''),text:''});
it('延迟保存只有一个在途请求，后续仅写最新缓冲并沿用确认hash',async()=>{
 const requests:SaveInput[]=[];let resolve!:(r:LoadedDoc)=>void;const b=new DocumentBuffer(loaded(),()=>{});
 vi.stubGlobal('window',{novelAPI:{saveDocument:(input:SaveInput)=>{requests.push(input);if(requests.length===1)return new Promise<LoadedDoc>(r=>resolve=r);return Promise.resolve({...b.loaded,hash:hash(input.text),revision:input.revision,text:input.text});}}});
 b.text='一';b.revision=1;const pending=b.flush();b.text='二';b.revision=2;b.text='三';b.revision=3;const another=b.flush();expect(requests).toHaveLength(1);resolve({...b.loaded,text:'一',hash:hash('一'),revision:1});await Promise.all([pending,another]);expect(requests.map(r=>r.text)).toEqual(['一','三']);expect(requests[1].baseHash).toBe(hash('一'));expect(b.dirty).toBe(false);
});
it('上次保存返回时若正在组合输入，不写半成品',async()=>{
 let resolve!:(r:LoadedDoc)=>void;const save=vi.fn(()=>new Promise<LoadedDoc>(r=>resolve=r));vi.stubGlobal('window',{novelAPI:{saveDocument:save}});const b=new DocumentBuffer(loaded(),()=>{});b.text='完成字';b.revision=1;const pending=b.flush();b.composing=true;b.text='未完成拼音';b.revision=2;resolve({...b.loaded,text:'完成字',hash:hash('完成字'),revision:1});await pending;expect(save).toHaveBeenCalledTimes(1);expect(b.dirty).toBe(true);await expect(b.flush()).rejects.toThrow('中文输入');
});
