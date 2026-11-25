import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/main/workspace/store';
import { defaultModel } from '../../src/main/settings';

async function fixture() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sirona-groups-'));
  const store = new Store();
  await store.create(temp, '临时作品');
  const profile = path.join(temp, 'profile');
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    model: defaultModel, fontSize: 20, lineHeight: 1.9,
    recent: [{ path: store.root, title: store.work.title }]
  }));
  const launch = () => electron.launch({
    args: process.env.NOVEL_TEST_EXE ? ['--headless-test'] : ['.', '--headless-test'],
    executablePath: process.env.NOVEL_TEST_EXE || undefined,
    env: { ...process.env, NOVEL_USER_DATA: profile }
  });
  return { store, temp, launch };
}

async function close(app: ElectronApplication) {
  await app.evaluate(({ app }) => app.exit()).catch(() => {});
  await app.close().catch(() => {});
}

async function enterName(page: Page, value: string, action: '创建' | '保存') {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('确认内容').fill(value);
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function addGroup(page: Page, kind: '卷' | '势力' | '分类', title: string) {
  const name = kind === '卷' ? /^新建(分)?卷$/ : '新建' + kind;
  await page.locator('.library').getByRole('button', { name, exact: true }).click();
  await enterName(page, title, '创建');
}

test('正文分卷从旧顺序开始，组内新建、改卷名、调整卷序，TXT 按侧栏导出', async () => {
  const { store, temp, launch } = await fixture();
  const firstDoc = store.work.documents[0];
  await store.updateDoc(firstDoc.id, { title: '旧稿' });
  await store.createDoc('chapter', '附记', '写在最后。');
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const list = page.locator('.library');
    const libraryButton = (name: string) => list.getByRole('button', { name, exact: true });
    await expect(libraryButton('旧稿')).toBeVisible();
    await expect(libraryButton('未分卷')).toHaveCount(0);
    await page.getByRole('textbox', { name: '正文编辑区' }).fill('旧章节的内容。');
    await page.getByRole('button', { name: '保存', exact: true }).click();

    await addGroup(page, '卷', '雨季');
    await libraryButton('旧稿的操作').click();
    await list.getByRole('combobox', { name: /移至.*卷/ }).selectOption({ label: '第一卷 · 雨季' });
    await libraryButton('第一卷 · 雨季').click();
    await expect(libraryButton('旧稿')).toBeHidden();
    await libraryButton('第一卷 · 雨季').click();
    await expect(libraryButton('旧稿')).toBeVisible();

    await addGroup(page, '卷', '');
    await libraryButton('第二卷的操作').click();
    await page.getByRole('button', { name: '在此新建章节', exact: true }).click();
    await page.locator('.chapter-title').click();
    await enterName(page, '归航', '保存');
    await page.getByRole('textbox', { name: '正文编辑区' }).fill('叙事从这里开始。');
    await libraryButton('第二卷的操作').click();
    await page.getByRole('button', { name: '上移', exact: true }).click();
    await expect(libraryButton('第二卷 · 雨季')).toBeVisible();
    await libraryButton('第一卷的操作').click();
    await page.getByRole('button', { name: '重命名', exact: true }).click();
    await enterName(page, '开端', '保存');
    await expect(page.locator('.manuscript .eyebrow')).toContainText('第一卷 · 开端');

    const output = path.join(temp, '导出.txt');
    await app.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    }, output);
    await page.evaluate(() => window.novelAPI.exportText());
    const lines = (await fs.readFile(output, 'utf8')).split(/\r?\n/).filter(Boolean);
    expect(lines).toEqual(['第一卷 · 开端', '归航', '叙事从这里开始。', '第二卷 · 雨季', '旧稿', '旧章节的内容。', '附记', '写在最后。']);
  } finally {
    await close(app);
  }
});

test('人物势力和设定分类独立，跨组移动、重启和解散后仍能打开原资料', async () => {
  const { store, launch } = await fixture();
  const character = await store.createDoc('character', '天青', '从海边来。');
  const setting = await store.createDoc('setting', '白塔', '塔有七层。');
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const selectTab = (tab: string) => page.locator('.library nav').getByRole('button', { name: tab, exact: true }).click();
    const libraryButton = (name: string) => page.locator('.library').getByRole('button', { name, exact: true });
    await selectTab('人物');
    await addGroup(page, '势力', '潮生社');
    await addGroup(page, '势力', '行会');
    await libraryButton('天青').click();
    await page.getByLabel('所属势力').selectOption({ label: '潮生社' });
    await page.getByRole('textbox', { name: '资料编辑区' }).fill('改投行会，仍住在海边。');
    await page.getByLabel('所属势力').selectOption({ label: '行会' });
    await expect(page.getByLabel('所属势力').locator('option:checked')).toHaveText('行会');

    await selectTab('设定');
    await addGroup(page, '分类', '城镇');
    await libraryButton('白塔').click();
    const category = page.getByLabel('所属分类');
    await expect(category.locator('option')).toHaveCount(2);
    await category.selectOption({ label: '城镇' });
    await expect(category.locator('option:checked')).toHaveText('城镇');
    await close(app);
    app = await launch();
    page = await app.firstWindow();
    await selectTab('设定');
    await libraryButton('白塔').click();
    await expect(page.getByLabel('所属分类').locator('option:checked')).toHaveText('城镇');
    await expect(page.getByRole('textbox', { name: '资料编辑区' })).toHaveText('塔有七层。');
    await selectTab('人物');
    await libraryButton('天青').click();
    await expect(page.getByLabel('所属势力').locator('option:checked')).toHaveText('行会');
    await libraryButton('行会的操作').click();
    await page.getByRole('button', { name: '解散势力', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '解散', exact: true }).click();
    await expect(libraryButton('行会')).toHaveCount(0);
    await expect(page.getByLabel('所属势力').locator('option:checked')).toHaveText('未归属');
    await expect(page.getByRole('textbox', { name: '资料编辑区' })).toHaveText('改投行会，仍住在海边。');
    const work = await page.evaluate(async () => (await window.novelAPI.boot()).workspace!);
    expect(work.documents.find(doc => doc.id === character.id)?.groupId ?? null).toBeNull();
    expect(work.documents.find(doc => doc.id === setting.id)?.groupId).toBe(work.groups?.find(group => group.title === '城镇')?.id);
  } finally {
    await close(app);
  }
});

test('移卷后定位到侧栏中的章节，取消分卷前显示章数和去向', async () => {
  const { store, launch } = await fixture();
  const chapter = store.work.documents[0];
  await store.createGroup('chapter', '长夜');
  await store.createGroup('chapter', '归途');
  const [destination, origin] = store.work.groups!;
  await store.updateDoc(chapter.id, { title: '潮生', groupId: origin.id });
  for (let i = 1; i <= 28; i++) {
    await store.createDoc('chapter', '长夜 ' + i, '', destination.id);
  }

  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sidebar = page.locator('.library');
    const libraryButton = (name: string) => sidebar.getByRole('button', { name, exact: true });
    const volume = libraryButton('第一卷 · 长夜');
    await volume.click();
    await expect(volume).toHaveAttribute('aria-expanded', 'false');
    await libraryButton('潮生').click();
    await expect(page.locator('.chapter-title')).toHaveText('潮生');

    const editor = page.getByRole('textbox', { name: '正文编辑区' });
    await editor.fill('潮声未停。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await sidebar.getByRole('button', { name: '搜索作品', exact: true }).click();
    const search = page.getByRole('dialog', { name: '搜索', exact: true });
    await search.getByLabel('搜索正文、人物或设定').fill('潮声未停。');
    await search.getByRole('button', { name: /正文 \/ 潮生/ }).click();
    await expect(search).toBeHidden();
    await libraryButton('潮生的操作').click();
    await sidebar.getByRole('combobox', { name: '移至卷', exact: true }).selectOption({ label: '第一卷 · 长夜' });

    const row = sidebar.locator('.library-document').filter({ has: page.getByRole('button', { name: '潮生', exact: true }) });
    await expect(row).toHaveClass(/just-moved/);
    expect(await row.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
    await expect(volume).toHaveAttribute('aria-expanded', 'true');
    await expect(row).toBeInViewport({ ratio: 0.95 });
    expect(await sidebar.locator('.document-list').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('.chapter-title')).toHaveText('潮生');
    await expect(row).not.toHaveClass(/just-moved/);

    await page.getByRole('button', { name: '选段问 AI', exact: true }).click();
    await expect(page.locator('.references')).toBeVisible();
    await page.locator('.references summary').click();
    await expect(page.locator('.references')).toContainText('已选择 5 字');
    await page.locator('.dock-head').getByRole('button', { name: '收起', exact: true }).click();

    async function confirmDialog() {
      await libraryButton('第一卷 · 长夜的操作').click();
      await libraryButton('取消分卷').click();
      return page.getByRole('dialog', { name: '取消分卷', exact: true });
    }
    const dialog = await confirmDialog();
    await expect(dialog).toContainText('「第一卷 · 长夜」中的 29 章将移到「未分卷」。');
    await dialog.getByRole('button', { name: '返回', exact: true }).click();
    await expect(volume).toBeVisible();
    await confirmDialog();
    await dialog.getByRole('button', { name: '取消分卷', exact: true }).click();
    await expect(volume).toHaveCount(0);
    await expect(libraryButton('未分卷')).toBeVisible();
    await expect(editor).toHaveText('潮声未停。');
  } finally {
    await close(app);
  }
});
