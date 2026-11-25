import { contextBridge, ipcRenderer } from 'electron';
import type { NovelAPI, Result, ChatRecord } from '../shared/types';
const call=async<T>(name:string,...args:unknown[]):Promise<T>=>{const result=await ipcRenderer.invoke('novel:rpc',name,args) as Result<T>;if(!result.ok)throw new Error(result.error);return result.value;};
const api:NovelAPI={
  boot:()=>call('boot'),createWorkspace:title=>call('createWorkspace',title),openWorkspace:p=>call('openWorkspace',p),
  renameWorkspace:title=>call('renameWorkspace',title),
  loadDocument:id=>call('loadDocument',id),saveDocument:input=>call('saveDocument',input),createDocument:(kind,groupId)=>call('createDocument',kind,groupId),updateDocument:(id,patch,direction)=>call('updateDocument',id,patch,direction),
  createGroup:(kind,title)=>call('createGroup',kind,title),updateGroup:(id,patch)=>call('updateGroup',id,patch),dissolveGroup:id=>call('dissolveGroup',id),
  history:id=>call('history',id),checkpoint:(input,reason)=>call('checkpoint',input,reason),restore:(id,snap)=>call('restore',id,snap),recoveryCopy:(id,text)=>call('recoveryCopy',id,text),reloadDocument:(id,text)=>call('reloadDocument',id,text),
  search:q=>call('search',q),readState:()=>call('readState'),saveState:patch=>call('saveState',patch),settings:patch=>call('settings',patch),models:()=>call('models'),chats:id=>call('chats',id),previewAi:input=>call('previewAi',input),startAi:input=>call('startAi',input),stopAi:()=>call('stopAi'),
  exportText:()=>call('exportText'),backup:()=>call('backup'),scanImport:()=>call('scanImport'),runImport:plan=>call('runImport',plan),confirmClose:()=>call('confirmClose'),
  onAi:fn=>{const listener=(_event:Electron.IpcRendererEvent,record:ChatRecord)=>fn(record);ipcRenderer.on('novel:ai',listener);return()=>ipcRenderer.removeListener('novel:ai',listener);},
  onClose:fn=>{const listener=()=>fn();ipcRenderer.on('novel:close',listener);return()=>ipcRenderer.removeListener('novel:close',listener);}
};contextBridge.exposeInMainWorld('novelAPI',api);
