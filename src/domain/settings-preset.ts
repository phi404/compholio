import type { BookStyle } from './contracts.js';
import type { BookModel, RunningElement, StyleCatalog, NamedStyle, SectionProperties } from './model.js';
import { defaultStyle, validateStyle } from './style.js';
import { defaultCatalog, validateCatalog } from './styles.js';
import { validatePublication } from './publication.js';
import { validateRunningElement } from './running.js';
import { object, textValue } from './validation.js';

export const MAX_SETTINGS_BYTES = 1024 * 1024;
export interface SettingsParts { layout: boolean; styles: boolean; decorations: boolean }
type PresetRunning = Omit<RunningElement, 'id' | 'scope'>;
export interface BookSettingsPreset {
  schemaVersion: 1; kind: 'book-settings'; name: string; style: BookStyle; catalog: StyleCatalog; running: PresetRunning[];
}
const kinds = ['characters', 'paragraphs', 'headings', 'pages', 'sections'] as const;
type StyleKind = typeof kinds[number];

function presetStyle(value: unknown): BookStyle {
  object(value, [...Object.keys(defaultStyle()), 'columnGapMm', 'maxCharsPerLine', 'maxLinesPerPage', 'pageCountMultiple'], '本の設定');
  object(value.page, ['widthMm', 'heightMm'], '用紙');
  object(value.margins, ['topMm', 'bottomMm', 'innerMm', 'outerMm'], '余白');
  object(value.folio, ['enabled', 'fromPage', 'startNumber', 'position', 'fontFamily', 'fontPt', 'insetMm', 'rules'], '番号');
  if (!Array.isArray(value.runningHeads) || value.runningHeads.length || !Array.isArray(value.folio.rules) || value.folio.rules.length || value.folio.fromPage !== 1 || value.folio.startNumber !== 1) throw new Error('本の設定には固定の柱やページ範囲を含められません。');
  return validateStyle(value);
}
export function validateBookSettingsPreset(value: unknown): BookSettingsPreset {
  object(value, ['schemaVersion', 'kind', 'name', 'style', 'catalog', 'running'], '設定テンプレート');
  if (value.schemaVersion !== 1 || value.kind !== 'book-settings') throw new Error('未対応の設定テンプレートです。元ファイルを保管してください。');
  textValue(value.name, 80, 'テンプレート名'); if (!value.name.trim()) throw new Error('テンプレートの名前を入力してください。');
  const style = presetStyle(value.style), catalog = validateCatalog(value.catalog);
  if (!Array.isArray(value.running) || value.running.length > 50) throw new Error('柱の設定を確認してください。');
  for (const entry of value.running) {
    object(entry, ['content', 'position', 'side', 'fontFamily', 'fontPt', 'insetMm', 'hideOnSectionFirst'], '柱の設定');
    object(entry.content, ['kind'], '柱の参照');
    if (entry.content.kind === 'text') throw new Error('設定テンプレートには固定の文章を含められません。');
    validateRunningElement({ ...entry, id: 'preset-running', scope: { kind: 'book' } }, style);
  }
  return structuredClone({ schemaVersion: 1, kind: 'book-settings', name: value.name.trim(), style, catalog, running: value.running }) as BookSettingsPreset;
}
export function createBookSettingsPreset(book: BookModel, name: string): BookSettingsPreset {
  const style = structuredClone(book.style);
  style.runningHeads = []; style.folio = { ...style.folio!, fromPage: 1, startNumber: 1, rules: [] };
  const running = book.runningElements.filter(item => item.scope.kind === 'book' && item.content.kind !== 'text').map(({ id: _id, scope: _scope, ...item }) => item);
  return validateBookSettingsPreset({ schemaVersion: 1, kind: 'book-settings', name, style, catalog: book.styles, running });
}
export function parseBookSettingsPreset(source: string): BookSettingsPreset {
  if (source.length > MAX_SETTINGS_BYTES) throw new Error('設定テンプレートは1MB以内にしてください。');
  let value: unknown; try { value = JSON.parse(source); } catch { throw new Error('設定テンプレートのJSONを読み込めません。元ファイルを確認してください。'); }
  return validateBookSettingsPreset(value);
}
function mergeCatalog(existing: StyleCatalog, incoming: StyleCatalog): StyleCatalog {
  type Entry = NamedStyle<Record<string, unknown>>;
  const target = structuredClone(existing) as unknown as Record<StyleKind, Entry[]>;
  const source = structuredClone(incoming) as unknown as Record<StyleKind, Entry[]>;
  const builtins = defaultCatalog(), maps = {} as Record<StyleKind, Map<string, string>>;
  for (const kind of kinds) {
    target[kind] ??= []; source[kind] ??= [];
    const occupied = new Set(target[kind].map(entry => entry.id)), reserved = new Set(builtins[kind]!.map(entry => entry.id)); let serial = 1;
    maps[kind] = new Map(source[kind].map(entry => {
      if (reserved.has(entry.id)) return [entry.id, entry.id];
      let id = 'preset-' + serial++; while (occupied.has(id)) id = 'preset-' + serial++; occupied.add(id); return [entry.id, id];
    }));
  }
  for (const kind of kinds) {
    const imported = source[kind].map(entry => {
      const next = { ...entry, id: maps[kind].get(entry.id)! };
      if (entry.basedOn) next.basedOn = maps[kind].get(entry.basedOn)!;
      if (entry.characterStyleId) next.characterStyleId = maps.characters.get(entry.characterStyleId)!;
      if (kind === 'sections') {
        const properties = next.properties as SectionProperties;
        if (properties.pageStyleId) properties.pageStyleId = maps.pages.get(properties.pageStyleId)!;
        if (properties.paragraphStyleId) properties.paragraphStyleId = maps.paragraphs.get(properties.paragraphStyleId)!;
      }
      return next;
    });
    const replaced = new Set(imported.map(entry => entry.id));
    target[kind] = [...target[kind].filter(entry => !replaced.has(entry.id)), ...imported];
  }
  return validateCatalog(target);
}
export function applyBookSettingsPreset(book: BookModel, value: BookSettingsPreset, parts: SettingsParts = { layout: true, styles: true, decorations: true }): BookModel {
  if (book.sourceDraft !== undefined) throw new Error('入力中の原稿を確定してから設定を適用してください。');
  if (![parts.layout, parts.styles, parts.decorations].some(Boolean)) throw new Error('適用する設定を選んでください。');
  const preset = validateBookSettingsPreset(value), style = structuredClone(parts.layout ? preset.style : book.style);
  // Physical numbering and the target book's literal content never come from the preset.
  const folio = book.style.folio ?? defaultStyle().folio!;
  style.runningHeads = structuredClone(book.style.runningHeads ?? []);
  style.folio = parts.decorations ? { ...preset.style.folio!, fromPage: folio.fromPage, startNumber: folio.startNumber, rules: structuredClone(folio.rules) } : structuredClone(folio);
  let runningElements = book.runningElements;
  if (parts.decorations) {
    const occupied = new Set([...book.runningElements, ...book.overrides].map(item => item.id)); let serial = 1;
    runningElements = book.runningElements.filter(item => item.scope.kind !== 'book' || item.content.kind === 'text');
    runningElements = [...runningElements, ...preset.running.map(item => { let id = 'preset-running-' + serial++; while (occupied.has(id)) id = 'preset-running-' + serial++; occupied.add(id); return { ...item, id, scope: { kind: 'book' as const } }; })];
  }
  return validatePublication({ ...book, style, styles: parts.styles ? mergeCatalog(book.styles, preset.catalog) : book.styles, runningElements }) as BookModel;
}
