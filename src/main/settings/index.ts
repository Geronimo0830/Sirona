import type { ModelConfig, Settings } from '../../shared/types';
import { exists, readJson, writeJson } from '../workspace/files';
import path from 'node:path';
export const defaultModel:ModelConfig={adapter:'generic',baseUrl:'https://api.deepseek.com',model:'',inputLimit:24000,maxOutputTokens:2000,thinking:false};
export interface CryptoStorage { available():Promise<boolean>; encrypt(value:string):Promise<Buffer>; decrypt(value:Buffer):Promise<string> }
type Disk=Omit<Settings,'hasKey'>&{encryptedKey?:string};
export class SettingsStore{
  private data:Disk={model:{...defaultModel},fontSize:20,lineHeight:1.9,recent:[]};private key='';private keyNotice='';private loaded=false;private queue=Promise.resolve();
  constructor(private directory:string,private crypto:CryptoStorage){}
  async load(){if(this.loaded)return;const file=path.join(this.directory,'settings.json');if(await exists(file)){this.data=await readJson<Disk>(file);if(this.data.encryptedKey){try{if(!await this.crypto.available())throw new Error('unavailable');this.key=await this.crypto.decrypt(Buffer.from(this.data.encryptedKey,'base64'));}catch{this.keyNotice='已保存的密钥暂时无法解密。离线写作不受影响，可重新填写或清除密钥。';}}}this.loaded=true;}
  public(){const{encryptedKey:_,...data}=this.data;return structuredClone({...data,hasKey:!!this.key,keyNotice:this.keyNotice});}
  secret(){return this.key;}
  async save(patch:{model?:ModelConfig;fontSize?:number;lineHeight?:number;key?:string;clearKey?:boolean}){
    await this.load(); const run=this.queue.catch(()=>{}).then(async()=>{
      const next=structuredClone(this.data);let nextKey=this.key;
      if(patch.model)next.model=patch.model;if(patch.fontSize!==undefined)next.fontSize=patch.fontSize;if(patch.lineHeight!==undefined)next.lineHeight=patch.lineHeight;
      if(patch.clearKey){nextKey='';delete next.encryptedKey;}
      if(patch.key!==undefined&&patch.key!==''){nextKey=patch.key;if(await this.crypto.available())next.encryptedKey=(await this.crypto.encrypt(nextKey)).toString('base64');else delete next.encryptedKey;}
      await writeJson(path.join(this.directory,'settings.json'),next);this.data=next;this.key=nextKey;if(patch.clearKey||patch.key)this.keyNotice=nextKey&&!next.encryptedKey?'系统加密不可用，密钥仅在本次运行中使用，退出后需重新填写。':'';
    });this.queue=run;await run;return this.public();
  }
  async recent(root:string,title:string){await this.load();const run=this.queue.catch(()=>{}).then(async()=>{const next=structuredClone(this.data);next.recent=[{path:root,title},...next.recent.filter(r=>r.path!==root)].slice(0,12);await writeJson(path.join(this.directory,'settings.json'),next);this.data=next;});this.queue=run;await run;}
}
