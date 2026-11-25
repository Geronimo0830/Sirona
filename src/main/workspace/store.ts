import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Workspace, DocGroup, DocMeta, Kind, LoadedDoc, SaveInput, Snapshot, RefOptions, ViewState, ChatRecord } from '../../shared/types';
import { chaptersInOrder, groupLabel, groupsFor } from '../../shared/organization';
import { atomic, exists, hash, newDirectory, readJson, safeFile, uuid, validId, writeJson } from './files';
const kindSchema = z.enum(['chapter','character','setting']);
const groupSchema = z.object({ id: z.uuid(), kind: kindSchema, title: z.string(), order: z.number().int() });
const metaSchema = groupSchema.extend({ groupId: z.uuid().nullable().optional(), aliases: z.array(z.string()), tags: z.array(z.string()), deletedAt: z.string().nullable() });
const schema = z.object({ schemaVersion: z.union([z.literal(1), z.literal(2)]), id: z.uuid(), title: z.string(), createdAt: z.string(), documents: z.array(metaSchema), groups: z.array(groupSchema).optional() });

function requireGroup(work: Workspace, id: string): DocGroup {
  const group = work.groups?.find(group => group.id === id);
  if (!group) throw new Error('找不到指定的分组');
  return group;
}

function checkDestination(work: Workspace, kind: Kind, id: string | null) {
  if (id !== null && requireGroup(work, id).kind !== kind) throw new Error('文档和目标分组的类型不同');
}

function documentsIncludingDeleted(work: Workspace, kind: Kind, groupId: string | null) {
  return work.documents.filter(doc => doc.kind === kind && (doc.groupId ?? null) === groupId).sort((a, b) => a.order - b.order);
}

function nextOrder(items: { order: number }[]) {
  return items.reduce((largest, item) => Math.max(largest, item.order), -1) + 1;
}

function moveOne(items: { id: string; order: number; deletedAt?: string | null }[], id: string, direction: number) {
  const index = items.findIndex(item => item.id === id && !item.deletedAt);
  if (index < 0 || !direction) return;
  const step = Math.sign(direction);
  let to = index + step;
  while (items[to]?.deletedAt) to += step;
  if (!items[to]) return;
  [items[index], items[to]] = [items[to], items[index]];
  items.forEach((item, order) => { item.order = order; });
}

function groupTitle(kind: Kind, title: string) {
  const name = title.trim();
  if (kind !== 'chapter' && !name) throw new Error(kind === 'character' ? '请输入势力名称' : '请输入分类名称');
  return name;
}
interface Session { id: string; hash: string; revision: number; historyAt: number }
export class Store {
  root = ''; work!: Workspace;
  private manifestHash = '';
  private sessions = new Map<string, Session>();
  private queues = new Map<string, Promise<unknown>>();
  locked = false;
  async queue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const before = this.queues.get(key) ?? Promise.resolve();
    const task = before.catch(() => {}).then(fn); this.queues.set(key, task);
    try { return await task; } finally { if (this.queues.get(key) === task) this.queues.delete(key); }
  }
  async drain() { await Promise.all([...this.queues.values()]); }
  assertWritable() { if (!this.root) throw new Error('请先打开作品'); if (this.locked) throw new Error('正在备份，请稍后编辑'); }
  async file(relative: string) { return safeFile(this.root, relative); }
  async create(parent: string, title: string) {
    const root = await newDirectory(await fs.realpath(parent), title);
    const doc: DocMeta = { id: uuid(), kind: 'chapter', title: '第一章', order: 0, aliases: [], tags: [], deletedAt: null };
    const work: Workspace = { schemaVersion: 1, id: uuid(), title: title.trim() || '未命名作品', createdAt: new Date().toISOString(), documents: [doc] };
    await atomic(path.join(root, 'documents', `${doc.id}.md`), ''); await writeJson(path.join(root, 'workspace.json'), work);
    return this.open(root);
  }
  async open(root: string) {
    await this.drain();
    const real = await fs.realpath(root);
    const file = await safeFile(real, 'workspace.json');
    let data: Workspace;
    try { data = schema.parse(await readJson(file)); } catch { throw new Error('作品目录损坏、版本不支持，或这是旧格式。旧作品请使用“导入旧作品”。原文件没有改变。'); }
    if (new Set(data.documents.map(d => d.id)).size !== data.documents.length) throw new Error('作品目录包含重复文档标识');
    const groupKinds = new Map((data.groups ?? []).map(group => [group.id, group.kind]));
    if (groupKinds.size !== (data.groups?.length ?? 0)) throw new Error('作品目录包含重复分组标识');
    if (data.documents.some(doc => doc.groupId && groupKinds.get(doc.groupId) !== doc.kind)) throw new Error('作品目录包含无效的分组归属');
    this.root = real; this.work = data; this.manifestHash = hash(await fs.readFile(file)); this.sessions.clear();
    return structuredClone(data);
  }
  meta(id: string, deleted = false) { validId(id); const doc = this.work?.documents.find(d => d.id === id); if (!doc || (!deleted && doc.deletedAt)) throw new Error('文档不存在或已在回收站'); return doc; }
  async text(id: string, deleted = false) { this.meta(id, deleted); return fs.readFile(await this.file(`documents/${id}.md`), 'utf8'); }
  async load(id: string): Promise<LoadedDoc> {
    return this.queue(id, async () => { const text = await this.text(id); const h = hash(text); let s = this.sessions.get(id);
      if (!s || s.hash !== h) { s = { id: uuid(), hash: h, revision: 0, historyAt: 0 }; this.sessions.set(id, s); }
      return { workspaceId: this.work.id, docId: id, editorSessionId: s.id, revision: s.revision, hash: h, text };
    });
  }
  async validate(input: SaveInput, allowEqual = false) {
    this.assertWritable(); this.meta(input.docId);
    const s = this.sessions.get(input.docId);
    if (input.workspaceId !== this.work.id || !s || s.id !== input.editorSessionId) throw new Error('编辑会话已过期，请保留副本后重新打开文档');
    if (input.revision < s.revision || (!allowEqual && input.revision === s.revision)) throw new Error('旧版本保存已拒绝');
    const text = await this.text(input.docId);
    if (input.baseHash !== s.hash || hash(text) !== s.hash) throw new Error('文件已被其他程序修改。请另存副本或重新载入，原文未被覆盖。');
    return { s, text };
  }
  async save(input: SaveInput): Promise<LoadedDoc> {
    return this.queue(input.docId, async () => {
      const { s, text } = await this.validate(input, true);
      if (input.revision === s.revision && input.text !== text) throw new Error('保存版本不匹配');
      if (input.text !== text) {
        if (!s.historyAt || Date.now() - s.historyAt >= 300000) { await this.snapshot(input.docId, text, '自动保存前'); s.historyAt = Date.now(); }
        if (hash(await this.text(input.docId)) !== s.hash) throw new Error('保存期间文件发生外部变化，请保留副本');
        await atomic(await this.file(`documents/${input.docId}.md`), input.text);
      }
      s.hash = hash(input.text); s.revision = input.revision;
      return { workspaceId: this.work.id, docId: input.docId, editorSessionId: s.id, revision: s.revision, hash: s.hash, text: input.text };
    });
  }
  async snapshot(id: string, content: string, reason: string) {
    const doc = this.meta(id, true); const snap: Snapshot = { id: uuid(), docId: id, title: doc.title, createdAt: new Date().toISOString(), reason, content, contentHash: hash(content) };
    await writeJson(await this.file(`.studio/history/${id}/${snap.id}.json`), snap); return snap;
  }
  async checkpoint(input: SaveInput, reason: string) { await this.queue(input.docId, async () => { const { text } = await this.validate(input, true); if (text !== input.text) throw new Error('请先保存当前内容'); await this.snapshot(input.docId, text, reason);if(hash(await this.text(input.docId))!==input.baseHash)throw new Error('保存历史期间原文发生变化，请重新载入'); }); }
  async history(id: string): Promise<Snapshot[]> {
    this.meta(id, true); const dir = await this.file(`.studio/history/${id}`); if (!await exists(dir)) return [];
    const result: Snapshot[] = [];
    for (const file of await fs.readdir(dir)) { if (!file.endsWith('.json')) continue; validId(file.slice(0,-5)); const snap = await readJson<Snapshot>(await this.file(`.studio/history/${id}/${file}`)); if (snap.docId !== id || hash(snap.content) !== snap.contentHash) throw new Error('历史快照校验失败'); result.push(snap); }
    return result.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  async restore(id: string, snapshotId: string) {
    await this.queue(id, async () => {
      this.assertWritable(); const text = await this.text(id); const s = this.sessions.get(id);
      if (!s || hash(text) !== s.hash) throw new Error('原文已变化，请重新载入');
      const snap = (await this.history(id)).find(x => x.id === snapshotId); if (!snap) throw new Error('找不到历史版本');
      await this.snapshot(id, text, '恢复历史前');
      if (hash(await this.text(id)) !== s.hash) throw new Error('恢复期间文件发生外部变化');
      await atomic(await this.file(`documents/${id}.md`), snap.content); this.sessions.delete(id);
    }); return this.load(id);
  }
  async mutate(fn: (work: Workspace) => Promise<void>) {
    return this.queue('manifest', async () => { this.assertWritable(); const file = await this.file('workspace.json');
      if (hash(await fs.readFile(file)) !== this.manifestHash) throw new Error('作品目录被外部修改，请重新打开');
      const next = structuredClone(this.work); await fn(next);
      if (hash(await fs.readFile(file)) !== this.manifestHash) throw new Error('作品目录发生外部变化');
      await writeJson(file, next); this.manifestHash = hash(await fs.readFile(file)); this.work = next; return structuredClone(next);
    });
  }
  async createGroup(kind: Kind, title: string) {
    const name = groupTitle(kind, title);
    return this.mutate(async work => {
      work.schemaVersion = 2;
      (work.groups ??= []).push({ id: uuid(), kind, title: name, order: nextOrder(groupsFor(work, kind)) });
    });
  }
  async updateGroup(id: string, patch: { title?: string; direction?: number }) {
    return this.mutate(async work => {
      const group = requireGroup(work, id);
      if (patch.title !== undefined) group.title = groupTitle(group.kind, patch.title);
      if (patch.direction) moveOne(groupsFor(work, group.kind), id, patch.direction);
    });
  }
  async dissolveGroup(id: string) {
    return this.mutate(async work => {
      const group = requireGroup(work, id);
      let order = nextOrder(documentsIncludingDeleted(work, group.kind, null));
      for (const doc of documentsIncludingDeleted(work, group.kind, id)) {
        doc.groupId = null;
        doc.order = order++;
      }
      work.groups = work.groups!.filter(entry => entry.id !== id);
    });
  }
  async createDoc(kind: Kind, title = '', content = '', groupId: string | null = null) {
    const id = uuid();
    const result = await this.mutate(async work => {
      checkDestination(work, kind, groupId);
      const order = nextOrder(documentsIncludingDeleted(work, kind, groupId));
      const doc: DocMeta = { id, kind, title, order, aliases: [], tags: [], deletedAt: null };
      if (groupId !== null) doc.groupId = groupId;
      await atomic(await this.file(`documents/${id}.md`), content);
      work.documents.push(doc);
    });
    return result.documents.find(doc => doc.id === id)!;
  }
  async updateDoc(id: string, patch: Partial<Pick<DocMeta,'title'|'aliases'|'tags'|'deletedAt'|'groupId'>>, direction?: number) {
    return this.queue(id, () => this.mutate(async work => {
      const doc = work.documents.find(d => d.id === id); if (!doc) throw new Error('文档不存在');
      const { groupId, ...metadata } = patch;
      if (groupId !== undefined && groupId !== (doc.groupId ?? null)) {
        checkDestination(work, doc.kind, groupId);
        doc.order = nextOrder(documentsIncludingDeleted(work, doc.kind, groupId));
        doc.groupId = groupId;
      }
      if (metadata.deletedAt && !doc.deletedAt) await this.snapshot(id, await this.text(id), '移入回收站前');
      Object.assign(doc, metadata);
      if (direction) moveOne(documentsIncludingDeleted(work, doc.kind, doc.groupId ?? null), id, direction);
    }));
  }
  async manuscriptText() {
    const work = this.work;
    const groups = new Map(groupsFor(work, 'chapter').map(group => [group.id, group]));
    const pieces: string[] = [];
    let previousGroup: string | null = null;
    for (const doc of chaptersInOrder(work)) {
      if (doc.groupId && doc.groupId !== previousGroup) pieces.push(groupLabel(work, groups.get(doc.groupId)!));
      pieces.push(doc.title + '\n\n' + await this.text(doc.id));
      previousGroup = doc.groupId ?? null;
    }
    return pieces.join('\n\n\n');
  }
  async search(query: string) {
    if (!query.trim()) return []; const result = [];
    for (const doc of this.work.documents.filter(d => !d.deletedAt)) { const text = await this.text(doc.id); const from = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()); if (from >= 0 || doc.title.includes(query) || doc.aliases.some(x=>x.includes(query))) result.push({ doc, from: Math.max(0,from), to: Math.max(0,from)+ (from>=0?query.length:0), excerpt: text.slice(Math.max(0,from-25),Math.max(0,from)+95) }); }
    return result;
  }
  async state() {
    const optional = async <T>(file: string, fallback: T): Promise<T> => { const p = await this.file(file); if (!await exists(p)) return fallback; return readJson<T>(p); };
    let view: ViewState = {}; try { view = await optional('.studio/view-state.json', {}); } catch { /* view never affects manuscript */ }
    const refs = await optional<Record<string,RefOptions>>('.studio/references.json', {});
    const p = await this.file('.studio/writing-preferences.txt');
    return { view, refs, preferences: await exists(p) ? await fs.readFile(p,'utf8') : '' };
  }
  async saveState(patch: {view?: ViewState;refs?: Record<string,RefOptions>;preferences?: string}) {
    await this.queue('state', async()=>{ this.assertWritable(); if (patch.view) await writeJson(await this.file('.studio/view-state.json'),patch.view); if (patch.refs) await writeJson(await this.file('.studio/references.json'),patch.refs); if (patch.preferences !== undefined) await atomic(await this.file('.studio/writing-preferences.txt'),patch.preferences); });
  }
  async chats(id: string) { this.meta(id, true); const p = await this.file(`.studio/chats/${id}.json`); if (!await exists(p)) return []; return readJson<ChatRecord[]>(p); }
  async putChat(record: ChatRecord) {
    await this.queue(`chat:${record.docId}`, async()=>{ if (this.locked || this.work.id !== record.workspaceId) throw new Error('作品已切换或正在备份'); const records = await this.chats(record.docId); const i = records.findIndex(r=>r.requestId===record.requestId); if(i<0)records.push(record);else records[i]=record; await writeJson(await this.file(`.studio/chats/${record.docId}.json`),records); });
  }
  async reload(id: string, buffer: string) { await this.queue(id,async()=>{this.assertWritable();await this.snapshot(id,buffer,'重新载入前的未保存恢复副本');this.sessions.delete(id);});return this.load(id); }
}
