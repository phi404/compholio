import type { BookAsset, PageElement, PageOverride, SpecialPageDefinition, SpecialRole } from './model.js';
import { identifier, object, textValue } from './validation.js';
import { finite, integer } from './style.js';
import { validatePage } from './styles.js';
import { fontDefinition } from './fonts.js';
import { paperHex } from './colors.js';

export const SPECIAL_ROLES: SpecialRole[] = ['title', 'chapter-title', 'toc', 'colophon', 'illustration', 'free', 'external'];
export const ROLE_NAMES: Record<SpecialRole, string> = { title: '表題紙', 'chapter-title': '章扉', toc: '目次', colophon: '奥付', illustration: '挿絵', free: '自由ページ', external: '外部ページ' };
export const MAX_PROJECT_BYTES = 80 * 1024 * 1024;
export function newSpecialPage(id: string, role: SpecialRole): SpecialPageDefinition {
  return { id, role, name: ROLE_NAMES[role], representation: role === 'free' ? 'layout' : role === 'external' || role === 'illustration' ? 'asset' : 'template',
    template: 'standard', fields: {}, elements: [], assetId: null, assetPage: 1, fit: 'contain',
    ...(['title', 'chapter-title', 'colophon', 'external'].includes(role) ? { localStyle: { showFolio: false, showHeads: false } } : {}) };
}
export function validateElement(value: unknown): asserts value is PageElement {
  object(value, ['id', 'kind', 'xMm', 'yMm', 'widthMm', 'heightMm', 'locked', 'text', 'fontFamily', 'fontPt', 'fontWeight', 'alignment', 'direction', 'assetId', 'assetPage', 'fit', 'color', 'strokeMm'], '自由ページの要素');
  identifier(value.id); finite(value.xMm, '横位置', 0, 350); finite(value.yMm, '縦位置', 0, 500);
  finite(value.widthMm, '幅', .1, 350); finite(value.heightMm, '高さ', .1, 500);
  if (value.locked !== undefined && typeof value.locked !== 'boolean') throw new Error('要素の固定を確認してください。');
  const base = ['id', 'kind', 'xMm', 'yMm', 'widthMm', 'heightMm', 'locked'];
  if (value.kind === 'text') {
    object(value, [...base, 'text', 'fontFamily', 'fontPt', 'fontWeight', 'alignment', 'direction'], '自由ページの文字'); textValue(value.text, 10000, '文字'); if(value.fontFamily !== undefined) fontDefinition(String(value.fontFamily)); finite(value.fontPt, '文字サイズ', 5, 72);
    if (![400, 700].includes(value.fontWeight as number) || !['start', 'center', 'end'].includes(value.alignment as string) || !['horizontal', 'vertical'].includes(value.direction as string)) throw new Error('自由ページの文字書式を確認してください。');
  } else if (value.kind === 'image') {
    object(value, [...base, 'assetId', 'assetPage', 'fit'], '自由ページの画像'); identifier(value.assetId); integer(value.assetPage, '素材内のページ', 1, 20);
    if (!['contain', 'cover'].includes(value.fit as string)) throw new Error('画像のフィットを確認してください。');
  } else if (value.kind === 'line' || value.kind === 'rect') {
    object(value, [...base, 'color', 'strokeMm'], '自由ページの図形'); if (typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value.color)) throw new Error('図形の色を確認してください。'); finite(value.strokeMm, '線幅', .05, 3);
  } else throw new Error('未対応のページ要素です。');
}
function fields(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 20) throw new Error('ページ内容を確認してください。');
  for (const [key, text] of Object.entries(value)) { if (!['title', 'subtitle', 'author', 'circle', 'date', 'printer', 'url', 'note'].includes(key)) throw new Error('未対応の内容フィールドです。元ファイルを保持してください。'); textValue(text, 4000, 'ページ内容'); }
}
export function validateSpecialPages(value: unknown): SpecialPageDefinition[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error('特殊ページは200件以内にしてください。');
  const ids = new Set<string>();
  for (const p of value) {
    object(p, ['id', 'role', 'name', 'representation', 'template', 'fields', 'elements', 'assetId', 'assetPage', 'fit', 'originalTemplate', 'imageMode', 'bleedMm', 'snapMm', 'pageStyleId', 'localStyle', 'toc', 'caption'], '特殊ページ'); identifier(p.id);
    if (p.caption !== undefined) {
      object(p.caption, ['text', 'numbered', 'fontPt'], '図の説明'); textValue(p.caption.text, 1000, '図の説明'); finite(p.caption.fontPt, '説明の文字サイズ', 5, 14);
      if (p.representation !== 'asset' || typeof p.caption.numbered !== 'boolean') throw new Error('図の説明は素材ページで指定してください。');
    }
    if (p.imageMode !== undefined && (!['flow', 'page', 'spread', 'bleed', 'external'].includes(p.imageMode as string) || p.representation !== 'asset')) throw new Error('画像の挿入方法を確認してください。');
    if (p.bleedMm !== undefined) finite(p.bleedMm, '塗り足し', 0, 10);
    if (p.pageStyleId !== undefined) identifier(p.pageStyleId); if (p.localStyle !== undefined) validatePage(p.localStyle);
    if (p.toc !== undefined) { object(p.toc, ['depth', 'fontPt', 'indentMm'], '目次の設定'); if (p.role !== 'toc' || ![1, 2, 3].includes(p.toc.depth as number)) throw new Error('目次の見出し階層を確認してください。'); finite(p.toc.fontPt, '目次の文字サイズ', 7, 14); finite(p.toc.indentMm, '目次の字下げ', 0, 8); }
    if (p.snapMm !== undefined) finite(p.snapMm, 'スナップ', 0, 10);
    if (ids.has(p.id)) throw new Error('特殊ページIDが重複しています。'); ids.add(p.id); textValue(p.name, 100, 'ページ名');
    if (!SPECIAL_ROLES.includes(p.role as SpecialRole) || !['template', 'layout', 'asset'].includes(p.representation as string) || !['standard', 'minimal'].includes(p.template as string) || !['contain', 'cover'].includes(p.fit as string)) throw new Error('特殊ページの種類を確認してください。');
    if (p.representation === 'template' && !['title', 'chapter-title', 'toc', 'colophon'].includes(p.role as string)) throw new Error('この種類のテンプレートには対応していません。元ファイルを保持してください。');
    fields(p.fields); if (p.assetId !== null) identifier(p.assetId); integer(p.assetPage, '素材内ページ', 1, 20);
    if (!Array.isArray(p.elements) || p.elements.length > 50) throw new Error('自由ページは50要素以内にしてください。');
    const elementIds = new Set<string>(); for (const e of p.elements) { validateElement(e); if (elementIds.has(e.id)) throw new Error('ページ要素IDが重複しています。'); elementIds.add(e.id); }
    if (p.originalTemplate !== undefined) { object(p.originalTemplate, ['template', 'fields'], '元テンプレート'); if (!['standard', 'minimal'].includes(p.originalTemplate.template as string)) throw new Error('元テンプレートを確認してください。'); fields(p.originalTemplate.fields); }
  }
  return structuredClone(value as SpecialPageDefinition[]);
}
const dataUrl = (value: unknown, mime: string) => {
  if (typeof value !== 'string' || value.length > MAX_PROJECT_BYTES || !new RegExp(`^data:${mime};base64,[A-Za-z0-9+/]*={0,2}$`, 'u').test(value)) throw new Error('素材のデータ形式を確認してください。');
};
export function validateAssets(value: unknown): BookAsset[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('素材は100件以内にしてください。');
  const ids = new Set<string>(); let size = 0;
  for (const a of value) {
    object(a, ['id', 'name', 'mediaType', 'original', 'bytes', 'images'], '素材'); identifier(a.id); if (ids.has(a.id)) throw new Error('素材IDが重複しています。'); ids.add(a.id); textValue(a.name, 200, '素材名');
    if (!['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf'].includes(a.mediaType as string)) throw new Error('未対応の素材形式です。'); dataUrl(a.original, (a.mediaType as string).replace('+', '\\+')); integer(a.bytes, '素材容量', 1, 16 * 1024 * 1024); size += (a.original as string).length;
    if (!Array.isArray(a.images) || !a.images.length || a.images.length > 20) throw new Error('素材は20ページ以内にしてください。');
    for (const image of a.images) {
      object(image, ['dataUrl', 'width', 'height', 'widthMm', 'heightMm'], '素材画像'); dataUrl(image.dataUrl, 'image/(?:png|jpeg)'); size += (image.dataUrl as string).length;
      integer(image.width, '画像幅', 1, 10000); integer(image.height, '画像高さ', 1, 10000);
      if ((image.width as number) * (image.height as number) > 16_000_000) throw new Error('素材画像が大きすぎます。');
      if (image.widthMm !== undefined) finite(image.widthMm, '素材幅', .1, 2000); if (image.heightMm !== undefined) finite(image.heightMm, '素材高さ', .1, 2000);
    }
  }
  if (size > MAX_PROJECT_BYTES) throw new Error('素材の合計が80MBを超えています。');
  return structuredClone(value as BookAsset[]);
}
export function validatePageOverrides(value: unknown): PageOverride[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('ページの例外は100件以内にしてください。');
  const ids = new Set<string>();
  for (const r of value) {
    object(r, ['id', 'pages', 'folio', 'hideHeads', 'paperColor'], '物理ページの例外'); identifier(r.id); if (ids.has(r.id)) throw new Error('ページ例外IDが重複しています。'); ids.add(r.id);
    if (!Array.isArray(r.pages) || !r.pages.length || r.pages.length > 100000 || new Set(r.pages).size !== r.pages.length) throw new Error('選択したページを確認してください。'); for (const n of r.pages) integer(n, '通しページ');
    if (r.folio !== undefined && typeof r.folio !== 'boolean' || r.hideHeads !== undefined && typeof r.hideHeads !== 'boolean') throw new Error('ページの表示を確認してください。');
    if (r.paperColor !== undefined) paperHex(r.paperColor as string);
  }
  return structuredClone(value as PageOverride[]);
}
