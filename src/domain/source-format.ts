import type { LocalStyle, SectionProperties } from './model.js';
import { validateLocal, validateSection } from './styles.js';

const paragraphKeys = new Set(['indentEm', 'insetEm', 'endInsetEm', 'beforeEm', 'afterEm', 'lineHeight', 'alignment', 'keepWithNext', 'orphans', 'widows']);
const characterKeys = new Set(['fontFamily', 'fontWeight', 'fontPt', 'letterSpacingEm', 'orientation', 'numbers', 'emphasis']);
const numeric = new Set(['indentEm', 'insetEm', 'endInsetEm', 'beforeEm', 'afterEm', 'lineHeight', 'fontWeight', 'fontPt', 'letterSpacingEm', 'columns', 'columnGapMm', 'maxCharsPerLine', 'maxLinesPerPage', 'topMm', 'bottomMm', 'innerMm', 'outerMm', 'numberStart', 'orphans', 'widows']);
const boolean = new Set(['keepWithNext', 'showHeads', 'showFolio']);
export function readAttributes(text: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  let rest = text.trim();
  while (rest) {
    const match = /^([a-zA-Z][\w.-]*)="([^"\r\n]*)"(?:\s+|$)/u.exec(rest);
    if (!match || match[1]! in result) throw new Error('書式の指定は 属性="値" の形で入力してください。');
    const key = match[1]!, value = match[2]!, leaf = key.split('.').at(-1)!;
    if (boolean.has(leaf) && !['true', 'false'].includes(value)) throw new Error('書式の真偽値を確認してください。');
    result[key] = numeric.has(leaf) ? value.trim() ? Number(value) : NaN : boolean.has(leaf) ? value === 'true' : value;
    rest = rest.slice(match[0].length);
  }
  return result;
}
export function readFormat(text: string): { localStyle?: LocalStyle; styleId?: string } {
  const attrs = readAttributes(text), local: LocalStyle = {};
  let styleId: string | undefined;
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'style') { styleId = String(value); continue; }
    if (key === 'pageStyle') { local.pageStyleId = String(value); continue; }
    const [family, child, margin] = key.split('.');
    if (family === 'page' && child) {
      local.page ??= {};
      if (child === 'margins' && margin) local.page.margins = { ...local.page.margins, [margin]: value };
      else Object.assign(local.page, { [child]: value });
    } else if (paragraphKeys.has(key)) local.paragraph = { ...local.paragraph, [key]: value };
    else if (characterKeys.has(key)) local.character = { ...local.character, [key]: value };
    else throw new Error(`未対応の書式属性「${key}」です。入力内容を保持しています。`);
  }
  validateLocal(local);
  return { ...(Object.keys(local).length ? { localStyle: local } : {}), ...(styleId ? { styleId } : {}) };
}
export function formatAttributes(local: LocalStyle = {}, styleId?: string): string {
  const attrs: Record<string, unknown> = { ...(styleId ? { style: styleId } : {}), ...local.paragraph, ...local.character, ...(local.pageStyleId ? { pageStyle: local.pageStyleId } : {}) };
  for (const [key, value] of Object.entries(local.page ?? {})) {
    if (key === 'margins') for (const [edge, size] of Object.entries(value as object)) attrs[`page.margins.${edge}`] = size;
    else attrs[`page.${key}`] = value;
  }
  return Object.entries(attrs).filter(([, value]) => value !== undefined).sort(([a], [b]) => a === 'alignment' ? -1 : b === 'alignment' ? 1 : a.localeCompare(b, 'en')).map(([key, value]) => `${key}="${value}"`).join(' ');
}
export function readSection(text: string): { styleId?: string; localStyle?: SectionProperties } {
  const attrs = readAttributes(text), { style: styleId, ...properties } = attrs;
  const page: Record<string, unknown> = {};
  const paragraph: Record<string, unknown> = {}, character: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) if (key.startsWith('page.')) {
    const [, child, edge] = key.split('.');
    if (child === 'margins' && edge) page.margins = { ...page.margins as object, [edge]: value }; else page[child!] = value;
    delete properties[key];
  } else if (paragraphKeys.has(key)) { paragraph[key] = value; delete properties[key]; } else if (characterKeys.has(key)) { character[key] = value; delete properties[key]; }
  if (Object.keys(page).length) Object.assign(properties, { page });
  if (Object.keys(paragraph).length) Object.assign(properties, { paragraph });
  if (Object.keys(character).length) Object.assign(properties, { character });
  validateSection(properties);
  return { ...(styleId ? { styleId: String(styleId) } : {}), ...(Object.keys(properties).length ? { localStyle: properties as SectionProperties } : {}) };
}
