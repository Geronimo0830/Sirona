import { useLayoutEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, isolateHistory, undo, redo } from '@codemirror/commands';
import { searchKeymap, search } from '@codemirror/search';
import type { LoadedDoc, SaveInput } from '../shared/types';

const setAppliedRange = StateEffect.define<{from: number; to: number} | null>();
const appliedMark = Decoration.mark({class: 'cm-ai-applied'});
const appliedRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(previous, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setAppliedRange)) {
        const range = effect.value;
        return range ? Decoration.set([appliedMark.range(range.from, range.to)]) : Decoration.none;
      }
    }
    return transaction.docChanged ? Decoration.none : previous;
  },
  provide: field => EditorView.decorations.from(field)
});

export class DocumentBuffer {
  revision:number;hash:string;text:string;savedRevision:number;error='';composing=false;state:EditorState;view:EditorView|null=null;timer?:ReturnType<typeof setTimeout>;saving?:Promise<void>;
  anchor=0;scroll=0;
  private appliedTimer?: ReturnType<typeof setTimeout>;

  constructor(public loaded:LoadedDoc,private notify:()=>void,private onManualSaved?:(buffer:DocumentBuffer)=>void){this.revision=loaded.revision;this.savedRevision=loaded.revision;this.hash=loaded.hash;this.text=loaded.text;
    this.state=EditorState.create({doc:this.text,extensions:[history(),search({top:true}),appliedRangeField,EditorView.lineWrapping,keymap.of([{key:'Mod-s',run:()=>{void this.saveManually().catch(()=>{});return true;}},...defaultKeymap,...historyKeymap,...searchKeymap]),EditorView.contentAttributes.of({'aria-label':'自由文本编辑区','spellcheck':'false'}),EditorView.updateListener.of(update=>{
      this.state=update.state;this.anchor=update.state.selection.main.head;
      if(update.docChanged){this.text=update.state.doc.toString();this.revision++;this.error='';this.schedule();this.notify();}
    }),EditorView.domEventHandlers({compositionstart:()=>{this.composing=true;},compositionend:()=>{this.composing=false;this.schedule();},scroll:(_e,view)=>{this.scroll=view.scrollDOM.scrollTop;}})]});
  }
  get dirty(){return this.revision!==this.savedRevision;}
  input():SaveInput{return{workspaceId:this.loaded.workspaceId,docId:this.loaded.docId,editorSessionId:this.loaded.editorSessionId,revision:this.revision,baseHash:this.hash,text:this.text};}
  schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>{if(!this.composing)void this.flush().catch(()=>{});},700);}
  async flush():Promise<void>{
    if(this.composing)throw new Error('请先完成当前中文输入，再执行此操作');
    clearTimeout(this.timer);if(this.saving){await this.saving;if(this.dirty)return this.flush();return;}
    if(!this.dirty)return;
    const task=(async()=>{this.notify();while(this.dirty){if(this.composing)return;const input=this.input();try{const result=await window.novelAPI.saveDocument(input);if(result.editorSessionId!==this.loaded.editorSessionId)throw new Error('编辑会话已变化');this.hash=result.hash;this.savedRevision=result.revision;this.error='';this.notify();}catch(error){this.error=error instanceof Error?error.message:'保存失败';this.notify();throw error;}}})();
    this.saving=task;try{await task;}finally{this.saving=undefined;this.notify();}
  }
  async saveManually() {
    await this.flush();
    if (!this.dirty) this.onManualSaved?.(this);
  }

  insert(text: string, from: number, to = from) {
    if (!this.view) throw new Error('请返回原章节后再采纳');
    const inserted = this.state.toText(text);
    const end = from + inserted.length;
    this.view.dispatch({
      changes: {from, to, insert: inserted},
      selection: {anchor: end},
      annotations: isolateHistory.of('full'),
      scrollIntoView: true
    });
    this.view.focus();
    return end;
  }

  highlightAppliedRange(from: number, to: number) {
    const view = this.view;
    if (!view || from >= to) return;
    clearTimeout(this.appliedTimer);
    view.dispatch({effects: setAppliedRange.of({from, to})});
    this.appliedTimer = setTimeout(() => {
      if (this.view === view) view.dispatch({effects: setAppliedRange.of(null)});
    }, 1400);
  }

  undo(){if(this.view)undo(this.view);}
  redo(){if(this.view)redo(this.view);}
  select(from:number,to=from){const end=this.state.doc.length;const selection={anchor:Math.min(from,end),head:Math.min(to,end)};this.anchor=selection.head;if(this.view)this.view.dispatch({selection,scrollIntoView:true});else this.state=this.state.update({selection}).state;}
  dispose(){clearTimeout(this.timer);clearTimeout(this.appliedTimer);}
}
export function Editor({buffer,label}:{buffer:DocumentBuffer;label:string}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{const view=new EditorView({state:buffer.state,parent:ref.current!});buffer.view=view;view.contentDOM.setAttribute('aria-label',label);view.scrollDOM.scrollTop=buffer.scroll;
    return()=>{buffer.scroll=view.scrollDOM.scrollTop;buffer.state=view.state.update({effects:setAppliedRange.of(null)}).state;buffer.view=null;view.destroy();};
  },[buffer,label]);
  return <div className="editor-host" ref={ref}/>;
}
