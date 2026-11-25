import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../../src/main/workspace/store';
import { chaptersInOrder, groupLabel } from '../../src/shared/organization';

async function fixture() {
  const store = new Store();
  await store.create(await fs.mkdtemp(path.join(os.tmpdir(), 'sirona-groups-unit-')), '样书');
  return store;
}

it('未分卷的旧作品原样导出，换卷和解散同时保护回收站文档、历史及人工引用', async () => {
  const store = await fixture();
  const original = store.work.documents[0];
  const end = await store.createDoc('chapter', '后记', '结束。');
  const manifest = await store.file('workspace.json');
  const before = await fs.readFile(manifest);
  await store.open(store.root);
  expect(await fs.readFile(manifest)).toEqual(before);
  expect(await store.manuscriptText()).toBe('第一章\n\n\n\n\n后记\n\n结束。');

  const volume = (await store.createGroup('chapter', '起始')).groups![0];
  await store.updateDoc(original.id, { groupId: volume.id });
  const removed = await store.createDoc('chapter', '插曲', '一段原稿。', volume.id);
  const note = await store.createDoc('character', '岚');
  await store.saveState({ refs: { [removed.id]: { mode: 'chapter', ids: [note.id], includeHistory: false } } });
  await store.updateDoc(removed.id, { deletedAt: new Date().toISOString() });
  await store.dissolveGroup(volume.id);
  expect(chaptersInOrder(store.work).map(doc => doc.id)).toEqual([end.id, original.id]);
  await store.updateDoc(removed.id, { deletedAt: null });
  expect(chaptersInOrder(store.work).map(doc => doc.id)).toEqual([end.id, original.id, removed.id]);
  expect(await store.text(removed.id)).toBe('一段原稿。');
  expect((await store.history(removed.id))[0].content).toBe('一段原稿。');
  expect((await store.state()).refs[removed.id].ids).toEqual([note.id]);
});

it('卷号随顺序生成，拒绝跨类型归类，同组移动在边界停止', async () => {
  const store = await fixture();
  for (let i = 0; i < 11; i++) await store.createGroup('chapter', '');
  const volumes = store.work.groups!;
  const last = volumes[10];
  expect(groupLabel(store.work, last)).toBe('第十一卷');
  await store.updateGroup(last.id, { direction: -1 });
  expect(groupLabel(store.work, last)).toBe('第十卷');
  const characterGroup = (await store.createGroup('character', '行会')).groups!.find(group => group.kind === 'character')!;
  const initial = store.work.documents[0];
  await expect(store.updateDoc(initial.id, { groupId: characterGroup.id })).rejects.toThrow();
  await expect(store.createDoc('setting', '街道', '', characterGroup.id)).rejects.toThrow();
  await expect(store.createGroup('setting', '  ')).rejects.toThrow();
  await store.updateDoc(initial.id, { groupId: volumes[0].id });
  const chapter = await store.createDoc('chapter', '二', '', volumes[0].id);
  const neighbor = await store.createDoc('chapter', '三', '', volumes[1].id);
  await store.updateDoc(chapter.id, {}, -1);
  await store.updateDoc(chapter.id, {}, -1);
  expect(chaptersInOrder(store.work).map(doc => doc.id)).toEqual([chapter.id, initial.id, neighbor.id]);
  await store.updateDoc(chapter.id, { groupId: volumes[1].id });
  expect(chaptersInOrder(store.work).map(doc => doc.id)).toEqual([initial.id, neighbor.id, chapter.id]);
});
