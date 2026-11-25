export type Kind = 'chapter' | 'character' | 'setting';
export interface DocGroup { id: string; kind: Kind; title: string; order: number }
export interface DocMeta { id: string; kind: Kind; title: string; order: number; groupId?: string | null; aliases: string[]; tags: string[]; deletedAt: string | null }
export interface Workspace { schemaVersion: 1 | 2; id: string; title: string; createdAt: string; documents: DocMeta[]; groups?: DocGroup[] }
export interface LoadedDoc { workspaceId: string; docId: string; editorSessionId: string; revision: number; hash: string; text: string }
export interface SaveInput { workspaceId: string; docId: string; editorSessionId: string; revision: number; baseHash: string; text: string }
export interface Snapshot { id: string; docId: string; title: string; createdAt: string; reason: string; content: string; contentHash: string }
export interface RefOptions { ids: string[]; mode: 'chapter' | 'selection' | 'none'; includeHistory: boolean }
export interface ViewState { chapterId?: string; positions?: Record<string, { anchor: number; scroll: number }>; left?: boolean; dock?: string | null }
export interface ModelConfig { adapter: 'generic' | 'deepseek'; baseUrl: string; model: string; inputLimit: number; maxOutputTokens: number; thinking: boolean }
export interface Settings { model: ModelConfig; fontSize: number; lineHeight: number; recent: { path: string; title: string }[]; hasKey: boolean; keyNotice?: string }
export interface AiInput { docId: string; sessionId: string; revision: number; hash: string; insertionPosition: number; selection?: { from: number; to: number; text: string }; refs: RefOptions; prompt: string }
export interface Reference { id: string; title: string; kind: string; content: string; hash: string }
export type AiStatus = 'connecting' | 'streaming' | 'completed' | 'stopped' | 'failed';
export interface ChatRecord { requestId: string; workspaceId: string; docId: string; sessionId: string; revision: number; hash: string; insertionPosition: number; selection?: { from: number; to: number; text: string }; rawUserPrompt: string; text: string; status: AiStatus; error?: string; createdAt: string; model: ModelConfig; references: Reference[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
export interface AiPreview { messages: { role: string; content: string }[]; characters: number; parts: { name: string; characters: number }[]; references: Reference[] }
export interface ImportEntry { path: string; bytes: number; hash: string; kind?: Kind; title?: string; issue?: string; docId?: string }
export interface ImportPlan { source: string; entries: ImportEntry[] }
export interface ImportReport { id: string; status: 'verified' | 'partial' | 'failed'; entries: ImportEntry[]; target: string; error?: string }
export interface Boot { settings: Settings; workspace?: Workspace; view?: ViewState; error?: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface NovelAPI {
  boot(): Promise<Boot>;
  createWorkspace(title: string): Promise<Workspace | null>;
  openWorkspace(path?: string): Promise<Workspace | null>;
  renameWorkspace(title: string): Promise<Workspace>;
  loadDocument(id: string): Promise<LoadedDoc>;
  saveDocument(input: SaveInput): Promise<LoadedDoc>;
  createDocument(kind: Kind, groupId?: string | null): Promise<DocMeta>;
  updateDocument(id: string, patch: Partial<Pick<DocMeta, 'title' | 'aliases' | 'tags' | 'deletedAt' | 'groupId'>>, direction?: number): Promise<Workspace>;
  createGroup(kind: Kind, title: string): Promise<Workspace>;
  updateGroup(id: string, patch: { title?: string; direction?: number }): Promise<Workspace>;
  dissolveGroup(id: string): Promise<Workspace>;
  history(id: string): Promise<Snapshot[]>;
  checkpoint(input: SaveInput, reason: string): Promise<void>;
  restore(id: string, snapshotId: string): Promise<LoadedDoc>;
  recoveryCopy(id: string, text: string): Promise<string | null>;
  reloadDocument(id: string, text: string): Promise<LoadedDoc>;
  search(query: string): Promise<{ doc: DocMeta; from: number; to: number; excerpt: string }[]>;
  readState(): Promise<{ view: ViewState; refs: Record<string, RefOptions>; preferences: string }>;
  saveState(patch: { view?: ViewState; refs?: Record<string, RefOptions>; preferences?: string }): Promise<void>;
  settings(patch?: { model?: ModelConfig; fontSize?: number; lineHeight?: number; key?: string; clearKey?: boolean }): Promise<Settings>;
  models(): Promise<string[]>;
  chats(docId: string): Promise<ChatRecord[]>;
  previewAi(input: AiInput): Promise<AiPreview>;
  startAi(input: AiInput): Promise<string>;
  stopAi(): Promise<void>;
  exportText(): Promise<string | null>;
  backup(): Promise<string | null>;
  scanImport(): Promise<ImportPlan | null>;
  runImport(plan: ImportPlan): Promise<ImportReport | null>;
  confirmClose(): Promise<void>;
  onAi(fn: (record: ChatRecord) => void): () => void;
  onClose(fn: () => void): () => void;
}
declare global { interface Window { novelAPI: NovelAPI } }
