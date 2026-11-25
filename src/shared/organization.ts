import type { DocGroup, DocMeta, Kind, Workspace } from './types';

export function groupKindLabel(kind: Kind) {
  return { chapter: '卷', character: '势力', setting: '分类' }[kind];
}

export function ungroupedLabel(kind: Kind) {
  return { chapter: '未分卷', character: '未归属', setting: '未分类' }[kind];
}

export function groupsFor(work: Workspace, kind: Kind): DocGroup[] {
  return (work.groups ?? []).filter(group => group.kind === kind).sort((a, b) => a.order - b.order);
}

export function documentsInGroup(work: Workspace, kind: Kind, groupId: string | null): DocMeta[] {
  return work.documents
    .filter(doc => doc.kind === kind && !doc.deletedAt && (doc.groupId ?? null) === groupId)
    .sort((a, b) => a.order - b.order);
}

function volumeNumber(number: number): string {
  if (number >= 10000 || number < 1) return String(number);
  const numerals = '零一二三四五六七八九';
  const units = ['', '十', '百', '千'];
  const digits = String(number);
  let result = '';
  let needsZero = false;
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[i]);
    if (digit === 0) {
      needsZero = true;
      continue;
    }
    if (needsZero) result += '零';
    const power = digits.length - 1 - i;
    if (!(i === 0 && digit === 1 && power === 1)) result += numerals[digit];
    result += units[power];
    needsZero = false;
  }
  return result;
}

export function groupLabel(work: Workspace, group: DocGroup): string {
  if (group.kind !== 'chapter') return group.title;
  const position = groupsFor(work, 'chapter').findIndex(volume => volume.id === group.id) + 1;
  const label = `第${volumeNumber(position)}卷`;
  return group.title ? `${label} · ${group.title}` : label;
}

export function chaptersInOrder(work: Workspace): DocMeta[] {
  const volumes = groupsFor(work, 'chapter');
  const ranks = new Map(volumes.map((volume, index) => [volume.id, index]));
  const rank = (doc: DocMeta) => ranks.get(doc.groupId ?? '') ?? volumes.length;
  return work.documents
    .filter(doc => doc.kind === 'chapter' && !doc.deletedAt)
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order);
}
