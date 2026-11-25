import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { documentsInGroup, groupKindLabel, groupLabel, groupsFor, ungroupedLabel } from '../shared/organization';
import type { DocGroup, DocMeta, Kind, Workspace } from '../shared/types';
import './library.css';

interface LibraryProps {
  hidden?: boolean;
  work: Workspace;
  section: Kind;
  chapter: string;
  note: string;
  setSection: (kind: Kind) => void;
  onSearch: () => void;
  onCollapse: () => void;
  onCreate: (groupId?: string | null) => void;
  onOpen: (doc: DocMeta) => void;
  onRename: (doc: DocMeta) => void;
  onHistory: (doc: DocMeta) => void;
  onRemove: (doc: DocMeta) => void;
  onReorder: (doc: DocMeta, direction: number) => void;
  onMove: (doc: DocMeta, groupId: string | null) => Promise<boolean | undefined>;
  onCreateGroup: () => void;
  onRenameGroup: (group: DocGroup) => void;
  onReorderGroup: (group: DocGroup, direction: number) => void;
  onDissolveGroup: (group: DocGroup) => void;
}

const sections: Kind[] = ['chapter', 'character', 'setting'];
const sectionNames = { chapter: '正文', character: '人物', setting: '设定' };
const documentTypes = { chapter: '章节', character: '人物', setting: '设定' };

function Actions({ title, children }: { title: string; children: () => ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <>
    <button className="library-actions-trigger" aria-label={title} aria-expanded={open}
      title={title} popoverTarget={id}>···</button>
    <div id={id} className="library-actions" popover="auto"
      onBeforeToggle={e => setOpen(e.newState === 'open')} onClick={e => {
      if (e.target instanceof Element && e.target.closest('button')) e.currentTarget.hidePopover();
    }}>
      {open && children()}
    </div>
  </>;
}

export function Library(props: LibraryProps) {
  const { work, section } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [movedChapter, setMovedChapter] = useState<{id: string; groupId: string | null; restoreFocus: boolean} | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const movedRowRef = useRef<HTMLDivElement>(null);
  const groups = groupsFor(work, section);
  const loose = documentsInGroup(work, section, null);
  const groupType = groupKindLabel(section);
  const docType = documentTypes[section];
  const currentId = section === 'chapter' ? props.chapter : props.note;
  const currentDoc = work.documents.find(doc => doc.id === currentId && doc.kind === section && !doc.deletedAt);
  const currentGroup = groups.find(group => group.id === currentDoc?.groupId);
  const looseKey = work.id + '-' + section + '-ungrouped';
  const movedDoc = section === 'chapter' && movedChapter
    ? work.documents.find(doc => doc.id === movedChapter.id && !doc.deletedAt && (doc.groupId ?? null) === movedChapter.groupId)
    : undefined;
  const movedVolume = groups.find(group => group.id === movedDoc?.groupId);

  useLayoutEffect(() => {
    const list = listRef.current;
    const row = movedRowRef.current;
    if (!movedChapter || !row || !list?.clientHeight) return;

    const viewport = list.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    if (target.top < viewport.top || target.height > list.clientHeight) {
      list.scrollTop += target.top - viewport.top;
    } else if (target.bottom > viewport.top + list.clientHeight) {
      list.scrollTop += target.bottom - (viewport.top + list.clientHeight);
    }
    if (movedChapter.restoreFocus && document.activeElement === document.body) {
      row.querySelector<HTMLButtonElement>('.library-actions-trigger')?.focus({preventScroll: true});
    }
  }, [movedChapter, work, section, props.hidden]);

  useEffect(() => {
    if (!movedChapter) return;
    const timer = window.setTimeout(() => setMovedChapter(null), 1500);
    return () => window.clearTimeout(timer);
  }, [movedChapter]);

  function expand(key: string) {
    setCollapsed(previous => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  }

  function toggle(key: string) {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function createIn(groupId: string | null) {
    expand(groupId ?? looseKey);
    props.onCreate(groupId);
  }

  async function moveToGroup(doc: DocMeta, select: HTMLSelectElement) {
    const destination = select.value || null;
    const restoreFocus = select.closest('.library-document')?.contains(document.activeElement) ?? false;
    select.closest<HTMLElement>('[popover]')?.hidePopover();
    if (!await props.onMove(doc, destination)) return;

    expand(destination ?? looseKey);
    if (doc.kind === 'chapter') setMovedChapter({id: doc.id, groupId: destination, restoreFocus});
  }

  function renderDocument(doc: DocMeta, index: number, documents: DocMeta[]) {
    const title = doc.title || '未命名' + docType;
    const justMoved = doc.id === movedDoc?.id;
    return <div key={doc.id} ref={justMoved ? movedRowRef : undefined}
      className={`document-row library-document${doc.id === currentId ? ' current' : ''}${justMoved ? ' just-moved' : ''}`}>
      <button title={title} aria-current={doc.id === currentId ? 'true' : undefined} onClick={() => props.onOpen(doc)}>{title}</button>
      <Actions title={title + '的操作'}>{() => <>
        <button onClick={() => props.onRename(doc)}>重命名</button>
        {groups.length > 0 && <label>移至{groupType}
          <select aria-label={'移至' + groupType} value={doc.groupId ?? ''}
            onChange={e => void moveToGroup(doc, e.currentTarget)}>
            <option value="">{ungroupedLabel(section)}</option>
            {groups.map(group => <option key={group.id} value={group.id}>{groupLabel(work, group)}</option>)}
          </select>
        </label>}
        {section === 'chapter' && <>
          <button disabled={index === 0} onClick={() => props.onReorder(doc, -1)}>上移</button>
          <button disabled={index === documents.length - 1} onClick={() => props.onReorder(doc, 1)}>下移</button>
        </>}
        <button onClick={() => props.onHistory(doc)}>历史</button>
        <button onClick={() => props.onRemove(doc)}>移至回收站</button>
      </>}</Actions>
    </div>;
  }

  function renderGroup(group: DocGroup | null, documents: DocMeta[], index: number) {
    const key = group?.id ?? looseKey;
    const expanded = !collapsed.has(key);
    const title = group ? groupLabel(work, group) : ungroupedLabel(section);
    const contentsId = 'library-items-' + key;
    return <div className="library-group" key={key}>
      <div className="library-group-header">
        <button className="library-group-toggle" aria-label={title} aria-expanded={expanded}
          aria-controls={contentsId} title={title} onClick={() => toggle(key)}>
          <span className="library-chevron" aria-hidden="true" />
          <span className="library-group-name">{title}</span>
          <span className="library-group-count" aria-hidden="true">{documents.length}</span>
        </button>
        {group && <Actions title={title + '的操作'}>{() => <>
          <button onClick={() => createIn(group.id)}>在此新建{docType}</button>
          <button onClick={() => props.onRenameGroup(group)}>重命名</button>
          {section === 'chapter' && <>
            <button disabled={index === 0} onClick={() => props.onReorderGroup(group, -1)}>上移</button>
            <button disabled={index === groups.length - 1} onClick={() => props.onReorderGroup(group, 1)}>下移</button>
          </>}
          <button onClick={() => props.onDissolveGroup(group)}>{section === 'chapter' ? '取消分卷' : '解散' + groupType}</button>
        </>}</Actions>}
      </div>
      <div className="library-group-items" id={contentsId} hidden={!expanded}>
        {expanded && documents.map(renderDocument)}
        {expanded && group && !documents.length &&
          <button className="library-empty-add" onClick={() => createIn(group.id)}>＋ 添加{docType}</button>}
      </div>
    </div>;
  }

  return <aside className="library" hidden={props.hidden}>
    <nav className="library-tabs" aria-label="作品内容" data-section={section}>
      <span className="library-tab-marker" aria-hidden="true" />
      {sections.map(kind => <button key={kind} aria-pressed={section === kind}
        onClick={() => props.setSection(kind)}>{sectionNames[kind]}</button>)}
    </nav>
    <div className="list-tools library-tools">
      <button title={currentGroup ? '在' + groupLabel(work, currentGroup) + '中新建' + docType : '新建' + docType}
        onClick={() => createIn(currentGroup?.id ?? null)}>＋ 新{docType}</button>
      <button onClick={props.onCreateGroup}>新建{groupType}</button>
      <button aria-label="搜索作品" onClick={props.onSearch}>搜索</button>
    </div>
    <div className="document-list" ref={listRef}>
      {groups.map((group, index) => renderGroup(group, documentsInGroup(work, section, group.id), index))}
      {groups.length && loose.length ? renderGroup(null, loose, -1) : loose.map(renderDocument)}
    </div>
    <span className="sr-only" role="status">
      {movedDoc ? `「${movedDoc.title || '未命名章节'}」已移至${movedVolume ? groupLabel(work, movedVolume) : ungroupedLabel('chapter')}。` : ''}
    </span>
    <button className="collapse" onClick={props.onCollapse}>收起侧栏</button>
  </aside>;
}
