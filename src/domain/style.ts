import type { BookStyle, DecorationPosition, FolioRule, PageRange, RunningHead } from './contracts.js';
import { pageSide } from './page-order.js';
import { ASCII_ADVANCES } from './font-metrics.js';
import { FONT_ADVANCES } from './font-advances.js';
import { fontDefinition } from './fonts.js';
import { paperHex, textHex } from './colors.js';
import { dashAdvance } from './text-symbols.js';
import { decorationSide, folioNumber, headsForPage } from './decoration.js';

export const PRESETS = {
  standard: { fontPt: 9, lineHeight: 1.8, margins: { topMm: 15, bottomMm: 16, innerMm: 17, outerMm: 13 } },
  compact: { fontPt: 8.5, lineHeight: 1.65, margins: { topMm: 13, bottomMm: 14, innerMm: 16, outerMm: 12 } },
  relaxed: { fontPt: 10, lineHeight: 1.95, margins: { topMm: 16, bottomMm: 18, innerMm: 18, outerMm: 14 } },
} as const;
export const PAGE_SIZES = {
  a6: { label: '文庫 / A6', widthMm: 105, heightMm: 148 },
  b6: { label: 'B6', widthMm: 128, heightMm: 182 },
  a5: { label: 'A5', widthMm: 148, heightMm: 210 },
  b5: { label: 'B5', widthMm: 182, heightMm: 257 },
  a4: { label: 'A4', widthMm: 210, heightMm: 297 },
  square: { label: '正方形', widthMm: 140, heightMm: 140 },
  shinsho: { label: '新書風', widthMm: 105, heightMm: 173 },
} as const;
export type Preset = keyof typeof PRESETS;
export const IMAGE_PRESETS = {
  square: { label:'正方形 · 1080 × 1080', widthMm:91.44, heightMm:91.44 },
  portrait: { label:'縦長 4:5 · 1080 × 1350', widthMm:91.44, heightMm:114.3 },
  landscape: { label:'横長 16:9 · 1600 × 900', widthMm:1600/300*25.4, heightMm:76.2 },
} as const;
export function imageStyle(current: BookStyle, preset: keyof typeof IMAGE_PRESETS): BookStyle {
  const page = IMAGE_PRESETS[preset], next = {...current,page:{widthMm:page.widthMm,heightMm:page.heightMm},fontPt:16,lineHeight:1.8,columns:1 as const,pageLayout:'uniform' as const,margins:{topMm:10,bottomMm:10,innerMm:10,outerMm:10},folio:{...current.folio!,enabled:false},runningHeads:[]};
  delete next.maxCharsPerLine; delete next.maxLinesPerPage; return validateStyle(next);
}
export function defaultStyle(): BookStyle { return presetStyle('standard'); }
export function presetStyle(name: Preset): BookStyle {
  return { page: { widthMm: 105, heightMm: 148 }, writingMode: 'vertical-rl', binding: 'right', columns: 1,
    fontFamily: 'Book Mincho', ...PRESETS[name], margins: { ...PRESETS[name].margins }, pageLayout: 'book', paragraphIndent: false,
    paperColor: 'white', textColor: '#282b28', folio: { enabled: true, fromPage: 1, startNumber: 1, position: 'bottom-outer', fontPt: 7, insetMm: 8, rules: [] }, runningHeads: [] };
}
export const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export const graphemes = (text: string): string[] => Array.from(segmenter.segment(text), item => item.segment);
export const advance = (glyph: string, family = 'Book Mincho'): number => {
  const metrics = FONT_ADVANCES[family] ?? ASCII_ADVANCES;
  return glyph === '\t' ? 4 : /^[\u200B\u200C\u200D\u2028\u2029\u2060\uFEFF]$/u.test(glyph) ? 0 : glyph === '\u00A0' ? metrics[' ']! : (dashAdvance(glyph) ?? metrics[glyph] ?? 1);
};
export const verticalAdvance=(glyph:string,orientation='mixed',family='Book Mincho'):number=>orientation==='upright'&&/^[0-9A-Za-z]$/u.test(glyph)?1:advance(glyph,family);
export function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}の値を確認してください。`);
  return value;
}
export function integer(value: unknown, label: string, min = 1, max = 100_000): number {
  const n = finite(value, label, min, max); if (!Number.isInteger(n)) throw new Error(`${label}は整数にしてください。`); return n;
}
function range<T extends PageRange>(rule: T): T {
  if (!rule || typeof rule.id !== 'string' || rule.id.length > 100) throw new Error('範囲の設定を確認してください。');
  integer(rule.from, '開始ページ'); if (rule.to !== null) integer(rule.to, '終了ページ', rule.from);
  return rule;
}
export const DECORATION_POSITIONS: readonly DecorationPosition[] = ['top-left', 'top-center', 'top-right', 'top-outer', 'top-inner', 'bottom-left', 'bottom-center', 'bottom-right', 'bottom-outer', 'bottom-inner'];
export function validateStyle(value: unknown): BookStyle {
  if (!value || typeof value !== 'object') throw new Error('組版設定を読み込めません。');
  const v = value as BookStyle, style = defaultStyle();
  if (!['vertical-rl', 'horizontal-tb'].includes(v.writingMode) || !['right', 'left'].includes(v.binding) || ![1, 2].includes(v.columns)) throw new Error('書字方向・段数の設定を確認してください。');
  fontDefinition(v.fontFamily); style.fontFamily = v.fontFamily;
  style.writingMode = v.writingMode; style.columns = v.columns; style.binding = v.binding;
  if (v.columnGapMm !== undefined) style.columnGapMm = finite(v.columnGapMm, '段間', 2, 30);
  style.page = { widthMm: finite(v.page?.widthMm, '用紙の幅', 60, 350), heightMm: finite(v.page?.heightMm, '用紙の高さ', 60, 500) };
  style.fontPt = finite(v.fontPt, '文字サイズ', 7, 18); style.lineHeight = finite(v.lineHeight, '行間', 1.55, 3);
  if (!v.margins || typeof v.margins !== 'object') throw new Error('余白がありません。');
  for (const key of ['topMm', 'bottomMm', 'innerMm', 'outerMm'] as const) style.margins[key] = finite(v.margins[key], '余白', 5, 70);
  const fontMm = style.fontPt * 25.4 / 72;
  if (style.page.widthMm - style.margins.innerMm - style.margins.outerMm < fontMm * style.lineHeight || style.page.heightMm - style.margins.topMm - style.margins.bottomMm < fontMm) throw new Error('余白が大きすぎて本文が入りません。用紙か余白を調整してください。');
  const area = geometry(style); if (area.inlineMm < fontMm || area.blockMm < fontMm * style.lineHeight) throw new Error('段間か余白が大きすぎて本文が入りません。');
  for (const key of ['maxCharsPerLine', 'maxLinesPerPage'] as const) if (v[key] !== undefined) style[key] = integer(v[key], '字数・行数', 1, 200);
  if (v.pageLayout !== undefined && v.pageLayout !== 'book' && v.pageLayout !== 'uniform') throw new Error('ページの組み方を確認してください。');
  style.pageLayout = v.pageLayout ?? 'book';
  if (v.paragraphIndent !== undefined && typeof v.paragraphIndent !== 'boolean') throw new Error('字下げを確認してください。');
  style.paragraphIndent = v.paragraphIndent ?? false;
  if (v.paperColor !== undefined) paperHex(v.paperColor);
  style.paperColor = v.paperColor ?? 'white';
  style.textColor = textHex(v.textColor);
  if (v.pageCountMultiple !== undefined) {
    if (![1, 2, 4, 8, 16].includes(v.pageCountMultiple)) throw new Error('総ページ数の単位を確認してください。');
    style.pageCountMultiple = v.pageCountMultiple;
  }
  if (v.folio) {
    const f = v.folio; if(f.fontFamily !== undefined) fontDefinition(f.fontFamily);
    if (typeof f.enabled !== 'boolean' || !DECORATION_POSITIONS.includes(f.position) || !Array.isArray(f.rules) || f.rules.length > 50) throw new Error('ノンブルの設定を確認してください。');
    const rules = f.rules.map((r: FolioRule) => {
      range(r); if (typeof r.enabled !== 'boolean') throw new Error('ノンブルの範囲を確認してください。');
      return { id: r.id, from: r.from, to: r.to, enabled: r.enabled, ...(r.startNumber === undefined ? {} : { startNumber: integer(r.startNumber, '開始番号', 0) }) };
    });
    style.folio = { ...(f.fontFamily ? { fontFamily: f.fontFamily } : {}), enabled: f.enabled, fromPage: integer(f.fromPage, '表示開始ページ'), startNumber: integer(f.startNumber, '開始番号', 0), position: f.position, fontPt: finite(f.fontPt, '番号の大きさ', 5, 12), insetMm: finite(f.insetMm, '番号の端からの距離', 3, 20), rules };
  }
  if (v.runningHeads !== undefined) {
    if (!Array.isArray(v.runningHeads) || v.runningHeads.length > 50) throw new Error('柱は50件以内にしてください。');
    style.runningHeads = v.runningHeads.map((r: RunningHead) => {
      range(r); if(r.fontFamily !== undefined) fontDefinition(r.fontFamily); if (!['both', 'odd', 'even'].includes(r.side) || !DECORATION_POSITIONS.filter(p => p.startsWith('top-')).includes(r.position) || typeof r.text !== 'string' || r.text.length > 100) throw new Error('柱の設定を確認してください。');
      return { ...(r.fontFamily ? { fontFamily: r.fontFamily } : {}), id: r.id, from: r.from, to: r.to, side: r.side, position: r.position, text: r.text, fontPt: finite(r.fontPt, '柱の大きさ', 5, 12), insetMm: finite(r.insetMm, '柱の端からの距離', 3, 20) };
    });
  }
  const decoration = (position: DecorationPosition, fontPt: number, insetMm: number, name: string) => {
    const size = fontPt * 25.4 / 72;
    if (position.startsWith('top-') ? insetMm < size || insetMm + size * .3 > style.margins.topMm : insetMm + size > style.margins.bottomMm) throw new Error(`${name}が本文の余白と重なります。${position.startsWith('top-') ? '天' : '地'}の余白を広げるか、端からの距離・大きさを小さくしてください。`);
  };
  if (style.folio && (style.folio.enabled || style.folio.rules.some(r => r.enabled))) decoration(style.folio.position, style.folio.fontPt, style.folio.insetMm, 'ノンブル');
  for (const head of style.runningHeads ?? []) if (head.text) decoration(head.position, head.fontPt, head.insetMm, '柱');
  if (style.folio?.position.startsWith('top-')) {
    // Every range/parity state changes only at a boundary. Check it and the next parity.
    const bounds = [1, style.folio.fromPage, ...style.folio.rules.flatMap(r => [r.from, ...(r.to === null ? [] : [r.to + 1])]), ...style.runningHeads!.flatMap(h => [h.from, ...(h.to === null ? [] : [h.to + 1])])];
    for (const page of new Set(bounds.flatMap(p => [p, p + 1]))) if (folioNumber(style.folio, page) !== null && headsForPage(style, page).some(h => decorationSide(style.pageLayout, page, h.position, style.binding) === decorationSide(style.pageLayout, page, style.folio!.position, style.binding))) throw new Error('柱とノンブルが同じ上部の位置にあります。どちらかの位置や対象範囲を変更してください。');
  }
  return style;
}
export function geometry(style: BookStyle) {
  const fontMm = style.fontPt * 25.4 / 72, lineMm = fontMm * style.lineHeight;
  const vertical = style.writingMode === 'vertical-rl', gap = style.columnGapMm ?? 6, width = style.page.widthMm - style.margins.innerMm - style.margins.outerMm, height = style.page.heightMm - style.margins.topMm - style.margins.bottomMm;
  const inlineMm = vertical ? (height - (style.columns - 1) * gap) / style.columns : (width - (style.columns - 1) * gap) / style.columns, blockMm = vertical ? width : height;
  const naturalChars = Math.max(1, Math.floor(inlineMm / fontMm)), naturalLines = Math.max(1, Math.floor(blockMm / lineMm));
  return { fontMm, lineMm, inlineMm, blockMm, gap, chars: Math.min(style.maxCharsPerLine ?? naturalChars, naturalChars), lines: Math.min(style.maxLinesPerPage ?? naturalLines, naturalLines), naturalChars, naturalLines };
}
/** In uniform mode outerMm is physical left, innerMm physical right, on every page. */
export function pageMargins(style: BookStyle, number: number): { left: number; right: number } {
  return style.pageLayout === 'uniform' || pageSide(number, style.binding) === 'left' ? { left: style.margins.outerMm, right: style.margins.innerMm } : { left: style.margins.innerMm, right: style.margins.outerMm };
}
