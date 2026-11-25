import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AiInput, AiPreview, ChatRecord, DocGroup, DocMeta, ImportPlan, Kind, LoadedDoc, RefOptions, Settings, Snapshot, ViewState, Workspace } from '../shared/types';
import { chaptersInOrder, documentsInGroup, groupKindLabel, groupLabel, groupsFor, ungroupedLabel } from '../shared/organization';
import { Library } from './Library';
import { DocumentBuffer, Editor } from './editor';
const api=window.novelAPI;
const labels:Record<Kind,string>={chapter:'正文',character:'人物',setting:'设定'};
const name=(d:DocMeta)=>d.title||({chapter:'未命名章节',character:'未命名人物',setting:'未命名设定'}[d.kind]);
const defaults:RefOptions={ids:[],mode:'chapter',includeHistory:true};
type Dialog={title:string;content:string;input?:string;nameInput?:'required'|'optional';options:string[];resolve:(value:string|null,index:number)=>void};
export function App(){
  const[work,setWork]=useState<Workspace|null>(null),[settings,setSettings]=useState<Settings|null>(null),[section,setSection]=useState<Kind>('chapter'),[chapter,setChapter]=useState<string>(''),[note,setNote]=useState<string>(''),[dock,setDock]=useState<'ai'|'note'|null>(null),[left,setLeft]=useState(true),[focused,setFocused]=useState(false),[menu,setMenu]=useState(false),[panel,setPanel]=useState<'settings'|'search'|'trash'|'history'|'import'|null>(null),[status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[,redraw]=useState(0);
  const[references,setReferences]=useState<Record<string,RefOptions>>({}),[preferences,setPreferences]=useState(''),[prompt,setPrompt]=useState(''),[chats,setChats]=useState<ChatRecord[]>([]),[generating,setGenerating]=useState(false),[preview,setPreview]=useState<AiPreview|null>(null),[selection,setSelection]=useState<{docId:string;revision:number;from:number;to:number;text:string}|null>(null),[query,setQuery]=useState(''),[results,setResults]=useState<Awaited<ReturnType<typeof api.search>>>([]),[snapshots,setSnapshots]=useState<Snapshot[]>([]),[historyDoc,setHistoryDoc]=useState(''),[importPlan,setImportPlan]=useState<ImportPlan|null>(null),[dialog,setDialog]=useState<Dialog|null>(null),[answer,setAnswer]=useState('');
  const [addedReference, setAddedReference] = useState<{chapterId: string; docId: string} | null>(null);
  const [preparingAi, setPreparingAi] = useState(false);
  const [manualSave, setManualSave] = useState<{buffer: DocumentBuffer; revision: number} | null>(null);
  const sendPending = useRef(false);
  const dockElement = useRef<HTMLElement>(null);
  const referenceAddedElement = useRef<HTMLSpanElement>(null);
  const buffers=useRef(new Map<string,DocumentBuffer>()),savedLayout=useRef<{left:boolean;dock:typeof dock}>({left:true,dock:null}),live=useRef<()=>Promise<void>>(async()=>{}),sessionKey=useRef(''),currentChapter=useRef(''),dialogRef=useRef<Dialog|null>(null),positions=useRef<ViewState['positions']>({});
  const refresh=()=>redraw(n=>n+1);
  function createBuffer(loaded: LoadedDoc) {
    return new DocumentBuffer(loaded, refresh, buffer => {
      if (buffer.loaded.workspaceId === sessionKey.current) setManualSave({buffer, revision: buffer.revision});
    });
  }
  const active=work?.documents.find(d=>d.id===chapter&&!d.deletedAt);const activeBuffer=buffers.current.get(chapter);const noteMeta=work?.documents.find(d=>d.id===note&&!d.deletedAt);const noteBuffer=buffers.current.get(note);
  const chapters = useMemo(() => work ? chaptersInOrder(work) : [], [work]);
  const activeVolume = active?.groupId ? work?.groups?.find(group => group.id === active.groupId) : undefined;
  const noteGroups = work && noteMeta ? groupsFor(work, noteMeta.kind) : [];
  currentChapter.current=chapter;
  const currentRefs=references[chapter]??defaults;
  const addedReferenceDoc = addedReference?.chapterId === chapter && currentRefs.ids.includes(addedReference.docId)
    ? work?.documents.find(doc => doc.id === addedReference.docId && !doc.deletedAt)
    : undefined;
  function ask(title:string,content:string,options=['确定','取消'],input?:string,nameInput?:Dialog['nameInput']):Promise<{value:string|null;index:number}>{return new Promise(resolve=>{const d:Dialog={title,content,options,input,nameInput,resolve:(value,index)=>resolve({value,index})};dialogRef.current=d;setAnswer(input??'');setDialog(d);});}
  function settle(index:number){const d=dialogRef.current;if(d){d.resolve(index===d.options.length-1&&d.options.length>1?null:answer,index);dialogRef.current=null;setDialog(null);}}
  async function run<T>(fn: () => Promise<T>) {
    try {
      setError('');
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  }
  async function flushAll(){for(const buffer of buffers.current.values())await buffer.flush();}
  async function ensureSaved(){try{await flushAll();return true;}catch(e){const bad=[...buffers.current.values()].find(b=>b.error||b.dirty);if(!bad)throw e;const choice=await ask('内容尚未保存',bad.error||String(e),['重试','另存副本','重新载入','取消离开']);if(choice.index===0)return ensureSaved();if(choice.index===1){const file=await api.recoveryCopy(bad.loaded.docId,bad.text);if(!file)return false;const reloaded=await api.reloadDocument(bad.loaded.docId,bad.text);bad.dispose();buffers.current.set(bad.loaded.docId,createBuffer(reloaded));refresh();setStatus('恢复副本已保存：'+file);return ensureSaved();}if(choice.index===2){const reloaded=await api.reloadDocument(bad.loaded.docId,bad.text);bad.dispose();buffers.current.set(bad.loaded.docId,createBuffer(reloaded));refresh();return ensureSaved();}return false;}}
  async function stopBeforeLeave(){if(!generating)return true;const r=await ask('正在生成回复','停止后才能切换作品、备份或关闭。已收到内容会保留。',['停止后继续','取消']);if(r.index!==0)return false;await api.stopAi();setGenerating(false);return true;}
  async function load(id:string){let b=buffers.current.get(id);if(!b){const loaded=await api.loadDocument(id);b=createBuffer(loaded);const pos=positions.current?.[id];if(pos){b.select(pos.anchor);b.scroll=pos.scroll;}buffers.current.set(id,b);}return b;}
  async function rememberView(){if(!work)return;const p={...positions.current};buffers.current.forEach((b,id)=>{p[id]={anchor:b.anchor,scroll:b.view?.scrollDOM.scrollTop??b.scroll};});positions.current=p;await api.saveState({view:{chapterId:chapter||undefined,positions:p,left,dock}});}
  async function initialize(next:Workspace){buffers.current.forEach(b=>b.dispose());buffers.current.clear();sessionKey.current=next.id;setWork(next);setNote('');setAddedReference(null);setDock(null);setPanel(null);setMenu(false);setPrompt('');setPreview(null);setSelection(null);setFocused(false);const state=await api.readState();positions.current=state.view.positions??{};setReferences(state.refs);setPreferences(state.preferences);setLeft(state.view.left??true);const id=next.documents.find(d=>d.id===state.view.chapterId&&!d.deletedAt&&d.kind==='chapter')?.id??chaptersInOrder(next)[0]?.id??'';if(id)await load(id);setChapter(id);setChats(id?await api.chats(id):[]);refresh();}
  async function switchChapter(id:string){if(!await ensureSaved())return;await rememberView();await load(id);setChapter(id);setPrompt('');setPreview(null);setSelection(null);setChats(await api.chats(id));}
  async function openNote(id:string){if(!await ensureSaved())return;await load(id);setNote(id);setFocused(false);setDock('note');}
  async function showAi(){if(!await ensureSaved())return;const wasVisible=!focused&&dock==='ai';setFocused(false);setDock(wasVisible?null:'ai');}
  async function chooseWorkspace(kind:'new'|'open',recent?:string){if(!await ensureSaved()||!await stopBeforeLeave())return;await rememberView();let next:Workspace|null;if(kind==='new'){const r=await ask('新建作品','给作品起个名字，也可以以后再改。',['选择保存位置','取消'],'');if(r.index!==0)return;next=await api.createWorkspace(r.value??'');}else next=await api.openWorkspace(recent);if(next){await initialize(next);setSettings(await api.settings());}}
  async function createDoc(groupId: string | null = null) {
    if (!work || !await ensureSaved()) return;
    const doc = await api.createDocument(section, groupId);
    setWork(current => current?.id === work.id ? {...current, documents: [...current.documents, doc]} : current);
    await load(doc.id);
    if (section === 'chapter') {
      setChapter(doc.id);
      setChats([]);
      setSelection(null);
      setPreview(null);
      setPrompt('');
    } else {
      setNote(doc.id);
      setDock('note');
      setFocused(false);
    }
  }

  async function createGroup() {
    if (!work) return;
    const label = groupKindLabel(section);
    const hint = section === 'chapter' ? '卷号按目录顺序排列。卷名可以留空。' : `输入这部作品的${label}名称。`;
    const compatibility = work.schemaVersion === 1 ? '建组后，请用新版 Sirona 打开这部作品。' : '';
    const result = await ask(`新建${label}`, hint + compatibility, ['创建', '取消'], '', section === 'chapter' ? 'optional' : 'required');
    if (result.index === 0 && await ensureSaved()) setWork(await api.createGroup(section, (result.value ?? '').trim()));
  }

  async function renameGroup(group: DocGroup) {
    const label = groupKindLabel(group.kind);
    const hint = group.kind === 'chapter' ? '卷号跟随顺序，卷名可以留空。' : `输入新的${label}名称。`;
    const result = await ask(`修改${label}名`, hint, ['保存', '取消'], group.title, group.kind === 'chapter' ? 'optional' : 'required');
    if (result.index === 0 && await ensureSaved()) setWork(await api.updateGroup(group.id, {title: (result.value ?? '').trim()}));
  }

  async function dissolveGroup(group: DocGroup) {
    if (!work) return;
    const title = groupLabel(work, group);
    let result;
    if (group.kind === 'chapter') {
      const count = documentsInGroup(work, 'chapter', group.id).length;
      const destination = groupsFor(work, 'chapter').length > 1 ? '「未分卷」' : '正文列表';
      const content = count
        ? `「${title}」中的 ${count} 章将移到${destination}。正文和历史版本会保留。`
        : `「${title}」将从目录中移除。`;
      result = await ask('取消分卷', content, ['取消分卷', '返回']);
    } else {
      const label = groupKindLabel(group.kind);
      result = await ask(`解散${label}`, `“${title}”中的条目将移到“${ungroupedLabel(group.kind)}”，内容和历史都会保留。`, ['解散', '取消']);
    }
    if (result.index === 0 && await ensureSaved()) setWork(await api.dissolveGroup(group.id));
  }

  async function moveDoc(doc: DocMeta, groupId: string | null) {
    if ((doc.groupId ?? null) === groupId || !await ensureSaved()) return false;
    const next = await api.updateDocument(doc.id, {groupId});
    if (next.id !== sessionKey.current) return false;
    setWork(next);
    return true;
  }

  async function addNoteReference(doc: DocMeta) {
    if (!chapter) throw new Error('请先打开一章正文');
    if (!work || !await ensureSaved()) return;
    if (sessionKey.current !== work.id || currentChapter.current !== chapter) return;
    if (!currentRefs.ids.includes(doc.id)) {
      await updateRefs({...currentRefs, ids: [...currentRefs.ids, doc.id]});
    }
    if (sessionKey.current !== work.id || currentChapter.current !== chapter) return;
    setAddedReference({chapterId: chapter, docId: doc.id});
    setDock('ai');
  }
  async function rename(doc:DocMeta){const r=await ask('修改名称','只修改名称，正文和引用保持不变。',['保存','取消'],doc.title);if(r.index===0){if(!await ensureSaved())return;setWork(await api.updateDocument(doc.id,{title:r.value??''}));}}
  async function remove(doc:DocMeta){if(!await ensureSaved())return;const r=await ask('移至回收站',`“${name(doc)}”可以在作品菜单的回收站恢复。`,['移至回收站','取消']);if(r.index!==0)return;const next=await api.updateDocument(doc.id,{deletedAt:new Date().toISOString()});setWork(next);if(note===doc.id){setNote('');setDock(null);}if(chapter===doc.id){const first=chaptersInOrder(next)[0];if(first)await switchChapter(first.id);else{setChapter('');setChats([]);}}}
  async function history(doc:DocMeta){if(!await ensureSaved())return;setHistoryDoc(doc.id);setSnapshots(await api.history(doc.id));setPanel('history');}
  async function updateRefs(next:RefOptions){const map={...references,[chapter]:next};await api.saveState({refs:map});setReferences(map);setPreview(null);}
  async function askSelection(){if(!activeBuffer||!await ensureSaved())return;const s=activeBuffer.state.selection.main;if(s.empty)throw new Error('请先选中一段正文');setSelection({docId:chapter,revision:activeBuffer.revision,from:s.from,to:s.to,text:activeBuffer.text.slice(s.from,s.to)});await updateRefs({...currentRefs,mode:'selection'});setFocused(false);setDock('ai');}
  function aiInput():AiInput{if(!activeBuffer)throw new Error('请先打开一章正文');if(currentRefs.mode==='selection'&&(!selection||selection.docId!==chapter||selection.revision!==activeBuffer.revision))throw new Error('请重新选择文字');return{docId:chapter,sessionId:activeBuffer.loaded.editorSessionId,revision:activeBuffer.revision,hash:activeBuffer.hash,insertionPosition:activeBuffer.state.selection.main.head,selection:currentRefs.mode==='selection'&&selection?{from:selection.from,to:selection.to,text:selection.text}:undefined,refs:currentRefs,prompt:prompt.trim()||'请根据这些材料协助我写作。'};}
  async function send() {
    if (generating || sendPending.current) return;
    if (!prompt.trim()) throw new Error('先写下想让 AI 帮什么');

    sendPending.current = true;
    setPreparingAi(true);
    try {
      if (!await ensureSaved()) return;
      if (sessionKey.current !== work?.id || currentChapter.current !== chapter) return;
      const input = aiInput();
      const nextPreview = await api.previewAi(input);
      if (sessionKey.current !== work?.id || currentChapter.current !== chapter) return;
      setPreview(nextPreview);
      if (nextPreview.characters > settings!.model.inputLimit) {
        throw new Error(`输入共 ${nextPreview.characters} 字符，超过 ${settings!.model.inputLimit}，请减少参考或关闭历史`);
      }
      await api.startAi(input);
      setPrompt('');
    } finally {
      sendPending.current = false;
      setPreparingAi(false);
    }
  }
  async function applyReply(record:ChatRecord,replace:boolean){
    if(!activeBuffer||chapter!==record.docId||work?.id!==record.workspaceId)throw new Error('请返回回复所属的原章节后再采纳');
    if(!await ensureSaved())return;const b=activeBuffer;let from=record.insertionPosition,to=from;
    const changed=b.revision!==record.revision||b.hash!==record.hash||b.loaded.editorSessionId!==record.sessionId;
    if(changed){const r=await ask('原文已经变化','请先在原章节选择新的位置或选区。本次将使用当前光标/选区。',['使用当前选择','取消']);if(r.index!==0)return;const s=b.state.selection.main;from=s.from;to=replace?s.to:s.from;if(replace&&s.empty)throw new Error('请先在原章节选择需要替换的文字');}
    else if(replace){if(!record.selection)throw new Error('该请求没有原始选区');from=record.selection.from;to=record.selection.to;}
    const fragment=window.getSelection()?.toString();const initial=fragment&&record.text.includes(fragment)?fragment:record.text;
    const chosen=await ask(replace?'预览替换内容':'预览插入内容',record.status==='completed'?'可在下方删去解释，只保留你想采用的文字。':'这是一条未完成的回复，请检查内容后采纳。',['采纳','取消'],initial);if(chosen.index!==0||!chosen.value)return;
    await b.flush();const revision=b.revision,session=b.loaded.editorSessionId,h=b.hash,target=currentChapter.current;
    await api.checkpoint(b.input(),'AI 采纳前');
    if(b.revision!==revision||b.hash!==h||b.loaded.editorSessionId!==session||!b.view||target!==record.docId||currentChapter.current!==target||sessionKey.current!==record.workspaceId)throw new Error('等待期间原文已变化，请重新选择后采纳');
    const end = b.insert(chosen.value, from, to);
    const appliedRevision = b.revision;
    await b.flush();
    if (b.revision !== appliedRevision || b.dirty || currentChapter.current !== target || sessionKey.current !== record.workspaceId) return;
    b.highlightAppliedRange(from, end);
    setStatus('已采纳，可按 Ctrl+Z 撤销');
  }
  useEffect(()=>{void run(async()=>{const boot=await api.boot();setSettings(boot.settings);if(boot.workspace)await initialize(boot.workspace);if(boot.error)setError(boot.error);});const offAi=api.onAi(record=>{setGenerating(record.status==='connecting'||record.status==='streaming');if(record.workspaceId===sessionKey.current)setChats(old=>{const map=new Map(old.map(r=>[r.requestId,r]));map.set(record.requestId,record);return[...map.values()];});});const offClose=api.onClose(()=>{void run(()=>live.current());});const interval=setInterval(()=>{for(const b of buffers.current.values())if(b.dirty&&!b.composing&&!b.error)void b.flush().catch(()=>{});},5000);return()=>{offAi();offClose();clearInterval(interval);};},[]);
  live.current=async()=>{if(!await ensureSaved()||!await stopBeforeLeave())return;await rememberView();await api.confirmClose();};
  useEffect(()=>{if(!work)return;const handle=setTimeout(()=>{void rememberView().catch(e=>setError(String(e)));},800);return()=>clearTimeout(handle);},[chapter,left,dock]);
  useEffect(()=>{if(panel!=='search'||!work)return;let stale=false;const timer=setTimeout(()=>{void api.search(query).then(value=>{if(!stale)setResults(value);}).catch(e=>{if(!stale)setError(String(e));});},200);return()=>{stale=true;clearTimeout(timer);};},[query,panel]);
  useEffect(()=>{if(!panel&&!dialog)return;const previous=document.activeElement as HTMLElement|null;const modal=[...document.querySelectorAll<HTMLElement>('[role=dialog]')].at(-1);if(!modal)return;const focusable=()=>[...modal.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,summary,[tabindex="0"]')].filter(e=>e.getClientRects().length);focusable()[0]?.focus();const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const items=focusable();const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){e.preventDefault();first?.focus();}};document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus();};},[panel,dialog]);
  const dockPage = focused ? null : dock === 'note' ? note : dock;
  useLayoutEffect(() => {
    const element = dockElement.current;
    if (!dockPage || !element || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
    const animations = Array.from(element.children, child =>
      child.animate([{opacity: 0.72}, {opacity: 1}], {duration: 160, easing: 'ease-out'})
    );
    return () => animations.forEach(animation => animation.cancel());
  }, [dockPage]);
  useLayoutEffect(() => {
    const element = referenceAddedElement.current;
    if (!element || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
    const animation = element.animate(
      [{backgroundColor: '#34373b'}, {backgroundColor: 'transparent'}],
      {duration: 800, easing: 'ease-out'}
    );
    return () => animation.cancel();
  }, [addedReference]);
  useEffect(() => {
    if (!manualSave) return;
    const timer = window.setTimeout(() => setManualSave(null), 1400);
    return () => window.clearTimeout(timer);
  }, [manualSave]);
  const style={'--read-size':`${settings?.fontSize??20}px`,'--read-line':settings?.lineHeight??1.9} as React.CSSProperties;
  const visibleChats=chats.filter(c=>c.docId===chapter);
  const runningReply = chats.find(record => record.status === 'connecting' || record.status === 'streaming');
  const aiProgress = generating
    ? (runningReply?.status === 'streaming' ? '正在生成回复…' : '等待模型回复…')
    : preparingAi ? '正在准备请求…' : '';
  const loadedBuffers = [...buffers.current.values()];
  const showManualSave = manualSave && manualSave.buffer.revision === manualSave.revision
    && (manualSave.buffer === activeBuffer || (dock === 'note' && manualSave.buffer === noteBuffer));
  const saveStatus = loadedBuffers.some(buffer => buffer.error) ? '有内容保存失败，请重试或另存副本'
    : loadedBuffers.some(buffer => buffer.saving) ? '正在保存…'
    : loadedBuffers.some(buffer => buffer.dirty) ? '未保存 · 正在等待写入'
    : showManualSave ? '已保存' : work ? '已保存到本地' : '本地优先 · AI 按需使用';
  const missingName = dialog?.nameInput === 'required' && !answer.trim();
  return <div className="app" style={style}>
    <header className="topbar"><button className="brand" onClick={()=>setMenu(!menu)}>Sirona <span>{work?.title??'你的故事，从这里开始'}</span> <span aria-hidden>⌄</span></button><div className="top-actions">{work&&<><button className="focus-toggle" aria-pressed={focused} onClick={()=>{if(focused){setLeft(savedLayout.current.left);setDock(savedLayout.current.dock);setFocused(false);}else{savedLayout.current={left,dock};setFocused(true);}}}>{focused?'退出专注':'专注'}</button><button aria-pressed={dock==='ai'&&!focused} onClick={()=>void run(showAi)}>AI 助手</button>{generating && (dock !== 'ai' || focused) && <button onClick={()=>void run(()=>api.stopAi())}>停止</button>}</>}</div></header>
    {menu&&<div className="work-menu"><button onClick={()=>void run(()=>chooseWorkspace('new'))}>新建作品</button><button onClick={()=>void run(()=>chooseWorkspace('open'))}>打开作品</button><button onClick={()=>void run(async()=>{if(!await ensureSaved()||!await stopBeforeLeave())return;const p=await api.scanImport();if(p){setImportPlan(p);setPanel('import');setMenu(false);}})}>导入旧作品</button>{settings?.recent.map(r=><button key={r.path} title={r.path} onClick={()=>void run(()=>chooseWorkspace('open',r.path))}>{r.title}</button>)}<hr/>{work&&<><button onClick={()=>void run(async()=>{const r=await ask('修改作品名','文件夹位置保持不变。',['保存','取消'],work.title);if(r.index===0){setWork(await api.renameWorkspace(r.value??''));setSettings(await api.settings());setMenu(false);}})}>修改作品名</button><button onClick={()=>void run(async()=>{if(!await ensureSaved()||!await stopBeforeLeave())return;const p=await api.exportText();if(p)setStatus('已导出：'+p);setMenu(false);})}>导出正文 TXT</button><button onClick={()=>void run(async()=>{if(!await ensureSaved()||!await stopBeforeLeave())return;setBusy(true);try{const p=await api.backup();if(p)setStatus('备份已完成：'+p);}finally{setBusy(false);}setMenu(false);})}>备份整个作品</button><button onClick={()=>{setPanel('trash');setMenu(false);}}>回收站</button></>}<button onClick={()=>{setPanel('settings');setMenu(false);}}>设置</button></div>}
    {error&&<div className="error" role="alert"><span>{error}</span><button onClick={()=>setError('')}>知道了</button></div>}
    {!work?<main className="welcome"><span className="eyebrow">一处安静的写作空间</span><h1>把故事写下来。</h1><p>正文、人物、设定，按照你的节奏慢慢生长。</p><div><button className="primary" onClick={()=>void run(()=>chooseWorkspace('new'))}>新建作品</button><button onClick={()=>void run(()=>chooseWorkspace('open'))}>打开作品</button><button onClick={()=>void run(async()=>{const p=await api.scanImport();if(p){setImportPlan(p);setPanel('import');}})}>导入旧作品</button></div><p className="muted">无需配置 AI，也可以离线写作。</p></main>:<div className={`workspace ${focused?'focused':''} ${dock&&!focused?'with-dock':''} ${!left?'no-left':''}`}>
      <Library key={work.id} hidden={focused || !left} work={work} section={section} chapter={chapter} note={note}
        setSection={setSection} onSearch={() => {setPanel('search'); setQuery('');}} onCollapse={() => setLeft(false)}
        onCreate={id => void run(() => createDoc(id))} onOpen={doc => void run(() => doc.kind === 'chapter' ? switchChapter(doc.id) : openNote(doc.id))}
        onRename={doc => void run(() => rename(doc))} onHistory={doc => void run(() => history(doc))} onRemove={doc => void run(() => remove(doc))}
        onReorder={(doc, direction) => void run(async () => {if (await ensureSaved()) setWork(await api.updateDocument(doc.id, {}, direction));})}
        onMove={(doc, id) => run(() => moveDoc(doc, id))} onCreateGroup={() => void run(createGroup)}
        onRenameGroup={group => void run(() => renameGroup(group))} onDissolveGroup={group => void run(() => dissolveGroup(group))}
        onReorderGroup={(group, direction) => void run(async () => {if (await ensureSaved()) setWork(await api.updateGroup(group.id, {direction}));})}
      />
      <main className="manuscript"><div className="editor-toolbar"><div>{!focused&&(!left||dock)&&<button className="show-list" onClick={()=>{setLeft(true);if(dock)setDock(null);}}>章节与资料</button>}<span>正文</span></div>{active&&<div><button onClick={()=>void run(askSelection)}>选段问 AI</button><button onClick={()=>activeBuffer?.undo()}>撤销</button><button onClick={()=>activeBuffer?.redo()}>重做</button><button onClick={()=>void run(async()=>{await activeBuffer?.saveManually();})}>保存</button></div>}</div>{active&&activeBuffer?<div className="page"><span className="eyebrow">{activeVolume && `${groupLabel(work, activeVolume)} / `}第 {chapters.findIndex(d=>d.id===active.id)+1} 章</span><button className="chapter-title" onClick={()=>void run(()=>rename(active))}>{name(active)}</button><Editor buffer={activeBuffer} label="正文编辑区"/></div>:<div className="empty">选择一章开始写作，或在左侧新建章节。</div>}</main>
      {!focused&&dock&&<aside className="dock" ref={dockElement}><div className="dock-head"><strong>{dock==='ai'?'AI 助手':noteMeta?labels[noteMeta.kind]:'资料'}</strong><button onClick={()=>void run(async()=>{if(await ensureSaved())setDock(null);})}>收起</button></div>{dock==='note'&&noteMeta&&noteBuffer&&<><button className="note-title" onClick={()=>void run(()=>rename(noteMeta))}>{name(noteMeta)}</button>{noteGroups.length > 0 && <label className="note-group-field">{noteMeta.kind === 'character' ? '所属势力' : '所属分类'}
        <select value={noteMeta.groupId ?? ''} onChange={e => {const id = e.currentTarget.value || null; void run(() => moveDoc(noteMeta, id));}}>
          <option value="">{ungroupedLabel(noteMeta.kind)}</option>
          {noteGroups.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}
        </select>
      </label>}<Editor buffer={noteBuffer} label="资料编辑区"/><details className="optional"><summary>更多信息</summary><label>别名（逗号分隔）<input key={'a'+noteMeta.id} defaultValue={noteMeta.aliases.join('，')} onBlur={e=>void run(async()=>setWork(await api.updateDocument(noteMeta.id,{aliases:e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean)})))}/></label><label>标签（逗号分隔）<input key={'t'+noteMeta.id} defaultValue={noteMeta.tags.join('，')} onBlur={e=>void run(async()=>setWork(await api.updateDocument(noteMeta.id,{tags:e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean)})))}/></label></details><button className="primary" onClick={() => void run(() => addNoteReference(noteMeta))}>加入 AI 参考</button><button onClick={()=>void run(()=>history(noteMeta))}>查看历史</button></>}
      {dock==='ai'&&<><details className="references"><summary>
        本次参考 · {currentRefs.ids.length} 条资料
        {addedReferenceDoc && <span ref={referenceAddedElement} className="reference-added" title={name(addedReferenceDoc)}>已加入「{name(addedReferenceDoc)}」</span>}
      </summary><label>正文范围<select value={currentRefs.mode} onChange={e=>void run(()=>updateRefs({...currentRefs,mode:e.target.value as RefOptions['mode']}))}><option value="chapter">本章全文</option><option value="selection">选中文字</option><option value="none">不带正文</option></select></label>{currentRefs.mode==='selection'&&<small>{selection?.docId===chapter&&selection.revision===activeBuffer?.revision?'已选择 '+Array.from(selection.text).length+' 字':'请重新在正文选择文字'}</small>}<div className="reference-options">{work.documents.filter(d=>d.kind!=='chapter'&&!d.deletedAt).map(d=><label className="check" key={d.id}><input type="checkbox" checked={currentRefs.ids.includes(d.id)} onChange={e=>void run(()=>updateRefs({...currentRefs,ids:e.target.checked?[...currentRefs.ids,d.id]:currentRefs.ids.filter(id=>id!==d.id)}))}/>{name(d)}</label>)}{currentRefs.ids.filter(id=>!work.documents.some(d=>d.id===id&&!d.deletedAt)).map(id=><button key={id} onClick={()=>void run(()=>updateRefs({...currentRefs,ids:currentRefs.ids.filter(x=>x!==id)}))}>失效资料 · 点击移除</button>)}</div><label className="check"><input type="checkbox" checked={currentRefs.includeHistory} onChange={e=>void run(()=>updateRefs({...currentRefs,includeHistory:e.target.checked}))}/>带入最近 6 轮已完成对话</label><small>旧回复可能提到之前的资料，关闭历史可不再带入。</small><button onClick={()=>void run(async()=>{if(await ensureSaved())setPreview(await api.previewAi(aiInput()));})}>查看实际发送内容</button></details>
      {preview&&<details open className="preview"><summary>本次输入 {preview.characters} 字符</summary>{preview.parts.map((p,i)=><small key={i}>{p.name}：{p.characters} 字符</small>)}<pre>{preview.messages.map(m=>`【${m.role}】\n${m.content}`).join('\n\n')}</pre></details>}
      <div className="conversation">{visibleChats.length===0&&<p className="muted">可以直接说：帮我想三个发展方向。<br/>只有发送时才调用模型。</p>}{visibleChats.map(record=><article className="message" key={record.requestId}><div className="user-message">{record.rawUserPrompt}</div><div className="assistant-message">{record.text || (['connecting', 'streaming'].includes(record.status) ? '正在等待回复…' : record.status === 'stopped' ? '已停止' : '未收到回复')}</div>{record.error&&<small className="warning">{record.error}</small>}<small>{record.model.model} · {record.status==='completed'?'完成':record.status==='stopped'?'已停止':record.status==='failed'?'未完成':'生成中'}{record.usage?` · 用量 ${record.usage.total_tokens??'服务未返回总量'}`:record.status==='completed'?' · 服务未返回用量':''}</small>{record.text&&!['connecting','streaming'].includes(record.status)&&<div className="message-actions"><button onClick={()=>void run(()=>applyReply(record,false))}>插入正文</button>{record.selection&&<button onClick={()=>void run(()=>applyReply(record,true))}>替换选段</button>}</div>}</article>)}</div><div className="composer"><label className="sr-only" htmlFor="ai-prompt">想让 AI 帮什么</label><textarea id="ai-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="想让 AI 帮什么？" onKeyDown={e=>{if(e.ctrlKey&&e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void run(send);}}}/><div><small role="status">{aiProgress || 'Ctrl+Enter 发送'}</small><button className="primary" disabled={!generating && (!chapter || preparingAi)} onClick={()=>void run(generating?()=>api.stopAi():send)}>{generating?'停止':'发送'}</button></div></div></>}
      </aside>}
    </div>}
    <footer><span>{saveStatus}</span><span className="status">{status}</span><span>{activeBuffer?Array.from(activeBuffer.text.replace(/\s/g,'')).length+' 字':''}</span></footer>
    {panel&&<div className="modal-backdrop"><section className={`modal ${panel==='settings'?'settings-modal':''}`} role="dialog" aria-modal="true" aria-label={panel==='settings'?'设置':panel==='search'?'搜索':panel==='history'?'历史':panel==='import'?'导入旧作品':'回收站'}><header><h2>{panel==='settings'?'设置':panel==='search'?'搜索作品':panel==='history'?'历史版本':panel==='import'?'导入旧作品':'回收站'}</h2><button onClick={()=>setPanel(null)}>关闭</button></header>
      {panel==='settings'&&settings&&<SettingsForm settings={settings} preferences={preferences} hasWork={!!work} onSave={async(p,key,clear,pref)=>{if(!await ensureSaved())return;const result=await api.settings({...p,key:key||undefined,clearKey:clear});setSettings(result);if(work){await api.saveState({preferences:pref});setPreferences(pref);}setStatus('设置已保存，没有调用模型');}} onError={setError}/>}
      {panel==='search'&&<><label>搜索正文、人物或设定<input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入关键词"/></label><div className="search-results">{results.map(r=><button key={r.doc.id} onClick={()=>void run(async()=>{if(r.doc.kind==='chapter')await switchChapter(r.doc.id);else await openNote(r.doc.id);buffers.current.get(r.doc.id)?.select(r.from,r.to);setPanel(null);})}><strong>{labels[r.doc.kind]} / {name(r.doc)}</strong><p>{r.excerpt}</p></button>)}</div></>}
      {panel==='trash'&&<div className="rows">{work?.documents.filter(d=>d.deletedAt).map(d=><div key={d.id}><span>{labels[d.kind]} · {name(d)}</span><button onClick={()=>void run(async()=>setWork(await api.updateDocument(d.id,{deletedAt:null}))) }>恢复</button></div>)}{!work?.documents.some(d=>d.deletedAt)&&<p className="muted">回收站是空的。</p>}</div>}
      {panel==='history'&&<div className="history-list">{snapshots.map(s=><details key={s.id}><summary>{new Date(s.createdAt).toLocaleString()} · {s.reason}</summary><pre>{s.content||'（空白内容）'}</pre><button onClick={()=>void run(async()=>{if(!await ensureSaved())return;const r=await ask('恢复这份内容','当前内容会先保留历史。仅恢复文字，不改变标题或排序。',['恢复','取消']);if(r.index!==0)return;const loaded=await api.restore(historyDoc,s.id);buffers.current.get(historyDoc)?.dispose();buffers.current.set(historyDoc,createBuffer(loaded));refresh();setPanel(null);setStatus('历史内容已恢复并保存');})}>恢复这份内容</button></details>)}{!snapshots.length&&<p className="muted">暂时没有历史版本。</p>}</div>}
      {panel==='import'&&importPlan&&<><p className="muted">来源只读。将复制到新目录，保留原文件和未知字段。</p><div className="import-list">{importPlan.entries.map((e,i)=><div key={e.path}><span>{e.path}<small>{e.issue??(e.kind?labels[e.kind]:'仅保留原始归档')}</small></span>{e.kind==='chapter'&&<button disabled={!i} onClick={()=>{const entries=[...importPlan.entries];[entries[i-1],entries[i]]=[entries[i],entries[i-1]];setImportPlan({...importPlan,entries});}}>上移</button>}</div>)}</div><button className="primary" onClick={()=>void run(async()=>{if(!await ensureSaved()||!await stopBeforeLeave())return;setBusy(true);try{const report=await api.runImport(importPlan);if(report){if(report.status==='failed')throw new Error(report.error||'导入失败');const boot=await api.boot();if(boot.workspace)await initialize(boot.workspace);setStatus(report.status==='partial'?'部分导入完成，请查看未转换清单':'复制导入完成');if(report.status==='partial')await ask('部分导入',report.entries.filter(e=>e.issue).map(e=>`${e.path}：${e.issue}`).join('\n'),['知道了']);}}finally{setBusy(false);}})}>选择新位置并开始复制导入</button></>}
    </section></div>}
    {dialog && <div className="modal-backdrop prompt-backdrop"><section className="modal prompt-dialog" role="dialog" aria-modal="true" aria-label={dialog.title}>
      <h2>{dialog.title}</h2><p>{dialog.content}</p>
      {dialog.nameInput ? <input autoFocus aria-label="确认内容" maxLength={500} value={answer} onChange={e=>setAnswer(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !missingName) settle(0);
          if (e.key === 'Escape') settle(1);
        }}/> : dialog.input !== undefined && <textarea autoFocus aria-label="确认内容" value={answer} onChange={e=>setAnswer(e.target.value)}/>}
      <div className="dialog-actions">{dialog.options.map((option,i) =>
        <button key={option} className={i === 0 ? 'primary' : ''} disabled={i === 0 && missingName} onClick={()=>settle(i)}>{option}</button>
      )}</div>
    </section></div>}
    {busy&&<div className="busy-overlay" role="status">正在处理文件，请稍候…</div>}
  </div>;
}
function SettingsForm({settings,preferences,hasWork,onSave,onError}:{settings:Settings;preferences:string;hasWork:boolean;onSave:(patch:Pick<Settings,'model'|'fontSize'|'lineHeight'>,key:string,clear:boolean,pref:string)=>Promise<void>;onError:(s:string)=>void}){
  const[model,setModel]=useState({...settings.model}),[fontSize,setFont]=useState(settings.fontSize),[lineHeight,setLine]=useState(settings.lineHeight),[key,setKey]=useState(''),[clear,setClear]=useState(false),[pref,setPref]=useState(preferences),[message,setMessage]=useState(''),[models,setModels]=useState<string[]>([]);
  const field=<K extends keyof typeof model>(k:K,v:(typeof model)[K])=>setModel({...model,[k]:v});
  return <form onSubmit={e=>{e.preventDefault();void onSave({model,fontSize,lineHeight},key,clear,pref).then(()=>{setKey('');setClear(false);setMessage('已保存');}).catch(err=>onError(String(err)));}}>
    <label>正文字号 · {fontSize}px<input type="range" min="16" max="28" value={fontSize} onChange={e=>setFont(Number(e.target.value))}/></label><label>行距 · {lineHeight}<input type="range" min="1.6" max="2.2" step="0.1" value={lineHeight} onChange={e=>setLine(Number(e.target.value))}/></label><hr/>
    <p className="warning">{settings.keyNotice}</p><p className="muted">模型配置可稍后填写。保存设置不会调用模型。</p><label>接口地址<input value={model.baseUrl} onChange={e=>field('baseUrl',e.target.value)} placeholder="https://api.deepseek.com"/></label><label>模型名<input list="model-list" value={model.model} onChange={e=>field('model',e.target.value)}/><datalist id="model-list">{models.map(m=><option key={m} value={m}/>)}</datalist></label><label>API Key · {settings.hasKey?'已配置，留空保持原样':'未配置'}<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label><label className="check"><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/>清除已保存密钥</label><button type="button" onClick={()=>void api.models().then(setModels).catch(e=>onError(String(e)))}>读取已保存配置的模型列表</button>
    <details><summary>高级模型设置</summary><label>接口类型<select value={model.adapter} onChange={e=>field('adapter',e.target.value as 'generic'|'deepseek')}><option value="generic">通用兼容接口</option><option value="deepseek">DeepSeek</option></select></label><label>输入字符上限<input type="number" min="4000" max="200000" value={model.inputLimit} onChange={e=>field('inputLimit',Number(e.target.value))}/></label><label>回复长度上限（tokens）<input type="number" min="256" max="8192" value={model.maxOutputTokens} onChange={e=>field('maxOutputTokens',Number(e.target.value))}/></label>{model.adapter==='deepseek'&&<label className="check"><input type="checkbox" checked={model.thinking} onChange={e=>field('thinking',e.target.checked)}/>使用思考模式</label>}</details>
    {hasWork&&<label>这部作品的写作偏好<textarea value={pref} onChange={e=>setPref(e.target.value)} placeholder="可以自由写下希望 AI 遵守的语气或限制，也可以留空。"/></label>}<div className="dialog-actions"><span>{message}</span><button className="primary" type="submit">保存设置</button></div>
  </form>;
}
