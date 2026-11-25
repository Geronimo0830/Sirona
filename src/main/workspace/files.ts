import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const uuid = () => randomUUID();
export const validId = (id: string) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('文档标识无效'); return id; };
export async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }
export async function atomic(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${uuid()}.pending`;
  const handle = await fs.open(temp, 'wx');
  try { await handle.writeFile(data, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  // Never remove the destination first. A failed rename leaves both the original and recovery temp.
  await fs.rename(temp, file);
}
export const readJson = async <T>(file: string): Promise<T> => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as T;
export const writeJson = (file: string, value: unknown) => atomic(file, JSON.stringify(value, null, 2));
export async function safeFile(root: string, relative: string): Promise<string> {
  const canonical = await fs.realpath(root);
  const full = path.resolve(canonical, relative);
  const rel = path.relative(canonical, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径超出了作品目录');
  let walk = canonical;
  for (const piece of rel.split(path.sep)) {
    walk = path.join(walk, piece);
    try { if ((await fs.lstat(walk)).isSymbolicLink()) throw new Error('作品内不支持符号链接或目录联接'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return full;
}
export function separate(a: string, b: string) {
  const inside = (parent: string, child: string) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  if (inside(a, b) || inside(b, a)) throw new Error('目标必须在来源之外，且两者不能互相包含');
}
export async function newDirectory(parent: string, title: string) {
  const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 60) || '未命名作品';
  const name = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe;
  for (let n = 0; n < 10000; n++) { const target = path.join(parent, name + (n ? ` (${n})` : '')); try { await fs.mkdir(target); return target; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
  throw new Error('无法创建新的作品目录');
}
