import type { CharacterProperties, ParagraphProperties } from './contracts.js';
import type { DocumentTree, LocalStyle, NamedStyle, StyleCatalog, TreeBlock, PageProperties, SectionProperties } from './model.js';
import { finite, integer } from './style.js';
import { identifier, object, textValue } from './validation.js';
import { fontDefinition } from './fonts.js';

export function defaultCatalog(): StyleCatalog {
  return {
    characters: [{ id: 'text', name: '標準', properties: { fontWeight: 400, numbers: 'auto' } }, { id: 'strong', name: '強調', basedOn: 'text', properties: { fontWeight: 700 } }],
    paragraphs: [{ id: 'body', name: '本文', properties: { alignment: 'start', keepWithNext: false }, characterStyleId: 'text' },
      { id: 'quote', name: '引用', basedOn: 'body', properties: { indentEm: 2 } },
      { id: 'centered', name: '中央揃え', basedOn: 'body', properties: { alignment: 'center', indentEm: 0 } }],
    headings: [{ id: 'chapter', name: '章見出し', properties: { indentEm: 0, alignment: 'start', keepWithNext: true }, characterStyleId: 'text' },
      { id: 'section', name: '節見出し', basedOn: 'chapter', properties: {} }, { id: 'small-heading', name: '小見出し', basedOn: 'section', properties: {} }],
    pages: [{ id: 'default-page', name: '本の基本', properties: {} }, { id: 'horizontal-page', name: '横書き', properties: { writingMode: 'horizontal-tb' } }, { id: 'two-column-page', name: '二段組', properties: { columns: 2, columnGapMm: 6 } }],
    sections: [{ id: 'default-section', name: '本文の章', properties: {} }],
  };
}
export function validateParagraph(value: unknown): asserts value is ParagraphProperties {
  object(value, ['indentEm', 'insetEm', 'endInsetEm', 'beforeEm', 'afterEm', 'lineHeight', 'alignment', 'keepWithNext', 'orphans', 'widows'], '段落書式');
  for (const key of ['orphans', 'widows']) if (value[key] !== undefined) integer(value[key], '段落の最少行数', 1, 10);
  if (value.indentEm !== undefined) finite(value.indentEm, '字下げ', 0, 8);
  for (const key of ['insetEm', 'endInsetEm', 'beforeEm', 'afterEm']) if (value[key] !== undefined) finite(value[key], '段落の余白', 0, 20);
  if (value.lineHeight !== undefined) finite(value.lineHeight, '行間', 1.55, 3);
  if (value.alignment !== undefined && !['start', 'center', 'end'].includes(value.alignment as string)) throw new Error('段落の揃えを確認してください。');
  if (value.keepWithNext !== undefined && typeof value.keepWithNext !== 'boolean') throw new Error('次段落との分離の設定を確認してください。');
}
export function validateCharacter(value: unknown): asserts value is CharacterProperties {
  object(value, ['fontFamily', 'fontWeight', 'fontPt', 'letterSpacingEm', 'orientation', 'numbers', 'emphasis'], '文字書式');
  if (value.fontFamily !== undefined) fontDefinition(String(value.fontFamily));
  if (value.fontWeight !== undefined && ![400, 700].includes(value.fontWeight as number)) throw new Error('文字の太さを確認してください。');
  if (value.fontPt !== undefined) finite(value.fontPt, '文字サイズ', 5, 36);
  if (value.letterSpacingEm !== undefined) finite(value.letterSpacingEm, '字間', 0, 1);
  if (value.orientation !== undefined && !['mixed', 'upright', 'sideways'].includes(value.orientation as string)) throw new Error('文字の向きを確認してください。');
  if (value.numbers !== undefined && !['auto', 'tcy', 'upright', 'sideways', 'kanji'].includes(value.numbers as string)) throw new Error('数字の組み方を確認してください。');
  if (value.emphasis !== undefined && !['sesame', 'dot', 'circle', 'triangle', 'none'].includes(value.emphasis as string)) throw new Error('圏点を確認してください。');
}
export function validatePage(value: unknown): asserts value is PageProperties {
  object(value, ['writingMode', 'columns', 'columnGapMm', 'fontPt', 'lineHeight', 'margins', 'maxCharsPerLine', 'maxLinesPerPage', 'showHeads', 'showFolio'], '版面書式');
  if (value.writingMode !== undefined && !['vertical-rl', 'horizontal-tb'].includes(value.writingMode as string)) throw new Error('書字方向を確認してください。');
  if (value.columns !== undefined && ![1, 2].includes(value.columns as number)) throw new Error('段数を確認してください。');
  if (value.columnGapMm !== undefined) finite(value.columnGapMm, '段間', 2, 30);
  if (value.fontPt !== undefined) finite(value.fontPt, '文字サイズ', 7, 18);
  if (value.lineHeight !== undefined) finite(value.lineHeight, '行間', 1.55, 3);
  for (const key of ['maxCharsPerLine', 'maxLinesPerPage']) if (value[key] !== undefined) { finite(value[key], '字数・行数', 1, 200); if (!Number.isInteger(value[key])) throw new Error('字数・行数は整数にしてください。'); }
  if (value.margins !== undefined) { object(value.margins, ['topMm', 'bottomMm', 'innerMm', 'outerMm'], '余白'); for (const n of Object.values(value.margins)) finite(n, '余白', 5, 70); }
  for (const key of ['showHeads', 'showFolio']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('ページの表示を確認してください。');
}
export function validateSection(value: unknown): asserts value is SectionProperties {
  object(value, ['pageStyleId', 'paragraphStyleId', 'start', 'numberStart', 'numberFormat', 'paragraph', 'character', 'page'], '章書式');
  if (value.numberStart !== undefined) integer(value.numberStart, '章の開始番号', 0, 100000);
  if (value.numberFormat !== undefined && !['decimal', 'roman', 'Roman'].includes(value.numberFormat as string)) throw new Error('章の番号の表し方を確認してください。');
  for (const key of ['pageStyleId', 'paragraphStyleId']) if (value[key] !== undefined) identifier(value[key]);
  if (value.start !== undefined && !['continuous', 'next', 'left', 'right', 'recto'].includes(value.start as string)) throw new Error('章の開始位置を確認してください。');
  if (value.paragraph !== undefined) validateParagraph(value.paragraph);
  if (value.character !== undefined) validateCharacter(value.character);
  if (value.page !== undefined) validatePage(value.page);
}
export function validateLocal(value: unknown): asserts value is LocalStyle {
  object(value, ['paragraph', 'character', 'page', 'pageStyleId'], 'ローカル書式');
  if (value.paragraph !== undefined) validateParagraph(value.paragraph);
  if (value.character !== undefined) validateCharacter(value.character);
  if (value.page !== undefined) validatePage(value.page);
  if (value.pageStyleId !== undefined) identifier(value.pageStyleId);
}
export function validateCatalog(value: unknown): StyleCatalog {
  object(value, ['characters', 'paragraphs', 'headings', 'pages', 'sections'], 'スタイル一覧');
  const normalized: Record<string, unknown> = { ...value, pages: value.pages ?? defaultCatalog().pages, sections: value.sections ?? defaultCatalog().sections };
  for (const kind of ['characters', 'paragraphs', 'headings', 'pages', 'sections'] as const) {
    const list = normalized[kind]; if (!Array.isArray(list) || !list.length || list.length > 100) throw new Error('スタイル一覧を確認してください。');
    const ids = new Set<string>();
    for (const entry of list) {
      object(entry, ['id', 'name', 'basedOn', 'properties', ...(['paragraphs', 'headings'].includes(kind) ? ['characterStyleId'] : [])], 'スタイル');
      identifier(entry.id); textValue(entry.name, 100, 'スタイル名');
      if (ids.has(entry.id)) throw new Error('スタイルIDが重複しています。'); ids.add(entry.id);
      if (entry.basedOn !== undefined) identifier(entry.basedOn);
      if (entry.characterStyleId !== undefined) identifier(entry.characterStyleId);
      if (kind === 'characters') validateCharacter(entry.properties); else if (kind === 'pages') validatePage(entry.properties); else if (kind === 'sections') validateSection(entry.properties); else validateParagraph(entry.properties);
    }
    const map = new Map(list.map(e => [e.id, e]));
    for (const entry of list) {
      const seen = new Set<string>(); let next = entry;
      while (next) {
        if (seen.has(next.id)) throw new Error('スタイルの継承が循環しています。'); seen.add(next.id);
        if (!next.basedOn) break;
        next = map.get(next.basedOn); if (!next) throw new Error('継承元のスタイルが見つかりません。');
      }
    }
  }
  const catalog = normalized as unknown as StyleCatalog;
  for (const entry of catalog.sections!) { const p = inheritedStyle(catalog.sections!, entry.id).properties; if (p.pageStyleId && !catalog.pages!.some(e => e.id === p.pageStyleId) || p.paragraphStyleId && !catalog.paragraphs.some(e => e.id === p.paragraphStyleId)) throw new Error('章スタイルの参照先が見つかりません。'); }
  for (const entry of [...catalog.paragraphs, ...catalog.headings]) if (entry.characterStyleId && !catalog.characters.some(c => c.id === entry.characterStyleId)) throw new Error('文字スタイルの参照先が見つかりません。');
  for (const [kind, id] of [['characters', 'text'], ['paragraphs', 'body'], ['headings', 'chapter'], ['headings', 'section'], ['headings', 'small-heading']] as const) if (!catalog[kind].some(e => e.id === id)) throw new Error('既定のスタイルがありません。');
  return structuredClone(catalog);
}
export function inheritedStyle<P extends object>(list: NamedStyle<P>[], id: string): { properties: P; characterStyleId?: string } {
  const entry = list.find(s => s.id === id); if (!entry) throw new Error(`スタイル「${id}」が見つかりません。`);
  const base = entry.basedOn ? inheritedStyle(list, entry.basedOn) : { properties: {} as P };
  const characterStyleId = entry.characterStyleId ?? base.characterStyleId;
  const properties = { ...base.properties, ...entry.properties };
  for (const key of ['paragraph', 'character'] as const) if (key in base.properties || key in entry.properties) Object.assign(properties, { [key]: { ...(key in base.properties ? (base.properties as Record<string, object>)[key] : {}), ...(key in entry.properties ? (entry.properties as Record<string, object>)[key] : {}) } });
  if ('margins' in base.properties || 'margins' in entry.properties) Object.assign(properties, { margins: { ...('margins' in base.properties ? base.properties.margins as object : {}), ...('margins' in entry.properties ? entry.properties.margins as object : {}) } });
  if ('page' in base.properties || 'page' in entry.properties) { const inherited = 'page' in base.properties ? base.properties.page as PageProperties : {}, own = 'page' in entry.properties ? entry.properties.page as PageProperties : {}; Object.assign(properties, { page: { ...inherited, ...own, ...(inherited.margins || own.margins ? { margins: { ...inherited.margins, ...own.margins } } : {}) } }); }
  return { properties, ...(characterStyleId ? { characterStyleId } : {}) };
}
export function blockStyleId(block: TreeBlock): string {
  return block.styleId ?? (block.kind === 'heading' ? block.level === 1 ? 'chapter' : block.level === 2 ? 'section' : 'small-heading' : block.role === 'quote' ? 'quote' : 'body');
}
export function applyLocalStyle(tree: DocumentTree, blockId: string, change: LocalStyle): DocumentTree {
  validateLocal(change); const next = structuredClone(tree), block = next.children.flatMap(s => s.children).find(b => b.id === blockId);
  if (!block || block.kind === 'pageBreak' || block.kind === 'specialPage') throw new Error('書式を変更する段落が見つかりません。');
  block.localStyle = { ...block.localStyle, ...change, ...(change.paragraph ? { paragraph: { ...block.localStyle?.paragraph, ...change.paragraph } } : {}), ...(change.character ? { character: { ...block.localStyle?.character, ...change.character } } : {}), ...(change.page ? { page: { ...block.localStyle?.page, ...change.page, ...(change.page.margins ? { margins: { ...block.localStyle?.page?.margins, ...change.page.margins } } : {}) } } : {}) };
  return next;
}
export function resetLocalStyle(tree: DocumentTree, blockId: string): DocumentTree {
  const next = structuredClone(tree), block = next.children.flatMap(s => s.children).find(b => b.id === blockId);
  if (!block) throw new Error('段落が見つかりません。'); delete block.localStyle; return next;
}
export function localStyleCount(block: TreeBlock): number { return Object.keys(block.localStyle?.paragraph ?? {}).length + Object.keys(block.localStyle?.character ?? {}).length + Object.keys(block.localStyle?.page ?? {}).length + Number(!!block.localStyle?.pageStyleId); }
