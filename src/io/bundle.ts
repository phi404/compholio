import type { Publication } from '../domain/model.js';
import { serializeProject, restoreProject } from '../domain/project.js';
import { createBookSettingsPreset } from '../domain/settings-preset.js';
import { asBook } from '../domain/book.js';
import { object, textValue } from '../domain/validation.js';
import { fontResource } from './resources.js';
import { bookFonts } from '../domain/font-use.js';
import { zipBlobs, readProductionFiles } from './zip.js';

export const MAX_BUNDLE_BYTES = 192 * 1024 * 1024;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(v => v.toString(16).padStart(2, '0')).join('');
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' } as const;
export function originalBytes(dataURL: string): Uint8Array {
  const payload = dataURL.slice(dataURL.indexOf(',') + 1), bytes = atob(payload);
  return Uint8Array.from(bytes, char => char.charCodeAt(0));
}
/** book.json is the canonical project. The loose source/assets are copies for other tools. */
export async function productionBundle(project: Publication, signal: AbortSignal): Promise<Blob> {
  const restored = restoreProject(serializeProject(project));
  const book = asBook(restored), files: Record<string, Uint8Array> = Object.create(null);
  files['book.json'] = new TextEncoder().encode(serializeProject(book));
  files[`manuscript.${book.syntax === 'markdown' ? 'md' : 'txt'}`] = new TextEncoder().encode(book.sourceDraft ?? book.source);
  files['settings.json'] = encode(createBookSettingsPreset(book, '制作データの設定'));
  const originals = book.assets.map((asset, index) => {
    const path = `assets/${String(index + 1).padStart(3, '0')}-${asset.id}.${extensions[asset.mediaType]}`;
    files[path] = originalBytes(asset.original);
    return { id: asset.id, name: asset.name, path, mediaType: asset.mediaType };
  });
  const includedFonts=bookFonts(book).map(fontResource);
  for(const font of includedFonts) for (const [name, url] of [[font.path, font.url], [font.license, font.licenseURL]] as const) {
    signal.throwIfAborted(); const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('制作データに同梱する書体を読み込めません。');
    files[name] = new Uint8Array(await response.arrayBuffer());
  }
  for(const font of includedFonts)if(await hash(files[font.path]!)!==font.sha256)throw new Error('同梱書体が変更されています。アプリを確認してから保存してください。');
  files['fonts.json'] = encode(includedFonts.map(({family,name,path,license})=>({family,name,path,license})));
  let total = 0;
  const entries = [];
  for (const [path, data] of Object.entries(files)) {
    signal.throwIfAborted(); total += data.byteLength;
    if (total > MAX_BUNDLE_BYTES) throw new Error('制作データが192MBを超えました。作業JSONを保存してください。');
    entries.push({ path, bytes: data.byteLength, sha256: await hash(data) });
  }
  files['manifest.json'] = encode({ schemaVersion: 1, kind: 'compholio-production', project: 'book.json', originals, files: entries });
  signal.throwIfAborted(); return zipBlobs(files);
}
export async function restoreProductionBundle(bytes: Uint8Array): Promise<Publication> {
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new Error('制作データは192MB以内にしてください。');
  const files = await readProductionFiles(bytes, MAX_BUNDLE_BYTES);
  const decode = (path: string) => { const file = files[path]; if (!file) throw new Error(`制作データに ${path} がありません。`); return new TextDecoder('utf-8', { fatal: true }).decode(file); };
  let manifest: unknown; try { manifest = JSON.parse(decode('manifest.json')); } catch { throw new Error('Compholioの制作データを選んでください。'); }
  object(manifest, ['schemaVersion', 'kind', 'project', 'originals', 'files'], '制作データ');
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'compholio-production' || manifest.project !== 'book.json' || !Array.isArray(manifest.files) || manifest.files.length > 210) throw new Error('未対応の制作データです。元ファイルを保管してください。');
  const paths = new Set(['manifest.json']);
  for (const entry of manifest.files) {
    object(entry, ['path', 'bytes', 'sha256'], '制作データのファイル'); textValue(entry.path, 200, 'ファイル名');
    if (paths.has(entry.path) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error('制作データの一覧を確認してください。'); paths.add(entry.path);
    const file = files[entry.path];
    if (!file || file.byteLength !== entry.bytes || await hash(file) !== entry.sha256) throw new Error(`制作データの ${entry.path} が変更または破損しています。`);
  }
  if (Object.keys(files).some(path => !paths.has(path))) throw new Error('一覧にないファイルが含まれています。');
  let fonts: unknown; try { fonts = JSON.parse(decode('fonts.json')); } catch { throw new Error('制作データの書体一覧を読み込めません。'); }
  const restored=restoreProject(decode('book.json')), expected=bookFonts(restored);
  if(!Array.isArray(fonts)||fonts.length!==expected.length)throw new Error('制作データの書体一覧を確認してください。');
  const seen=new Set<string>();
  for(const entry of fonts){object(entry,['family','name','path','license'],'制作データの書体');const font=fontResource(String(entry.family));
    if(seen.has(font.family)||!expected.includes(font.family)||entry.name!==font.name||entry.path!==font.path||entry.license!==font.license||!files[font.path]||await hash(files[font.path]!)!==font.sha256)throw new Error('制作データの書体が現在のCompholioと異なります。元の書体を保管してください。');
    if(!files[font.license]?.byteLength)throw new Error('制作データの書体ライセンスがありません。');seen.add(font.family);
  }
  decode('settings.json');const book=asBook(restored);decode(`manuscript.${book.syntax === 'markdown' ? 'md' : 'txt'}`);return book;
}
