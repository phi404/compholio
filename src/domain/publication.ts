import { validatePrintSettings } from './print.js';
import type { DocumentTree, Publication, Section, SourceSyntax, TreeBlock, StyleCatalog } from './model.js';
import { MAX_SOURCE } from './document.js';
import { blockSource, contentKey, identityKey, sourceBlocks } from './source.js';
import type { SourceBlock } from './source.js';
import { formatAttributes } from './source-format.js';
import { defaultStyle, integer, validateStyle } from './style.js';
import { blockStyleId, defaultCatalog, validateCatalog, validateLocal, validateParagraph, validateCharacter, validateSection } from './styles.js';
import { validateScope } from './scope.js';
import { identifier, object, textValue } from './validation.js';
import { validateRunningElement } from './running.js';
import { newSpecialPage, SPECIAL_ROLES, validateSpecialPages, validateAssets, validatePageOverrides } from './special.js';

export const flattenDocument = (tree: DocumentTree): TreeBlock[] => tree.children.flatMap(s => s.children);
export function sourceOf(tree: DocumentTree, syntax: SourceSyntax): string {
  if (syntax !== 'markdown') return flattenDocument(tree).map(b => blockSource(b, syntax)).join('\n');
  const lines: string[] = []; let open = '';
  const close = () => { if (open) { lines.push(':::'); open = ''; } };
  for (const section of tree.children) {
    const { page, paragraph, character, ...properties } = section.localStyle ?? {};
    const attrs = { ...(section.styleId ? { style: section.styleId } : {}), ...properties, ...(section.start ? { start: section.start } : {}) };
    const directive = Object.entries(attrs).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}="${value}"`).join(' '), pageAttrs = formatAttributes({ ...(page ? { page } : {}), ...(paragraph ? { paragraph } : {}), ...(character ? { character } : {}) });
    if (directive || pageAttrs) { close(); lines.push(`:::section ${[directive, pageAttrs].filter(Boolean).join(' ')}`); }
    for (const block of section.children) {
      const format = 'inlines' in block ? formatAttributes({ ...block.localStyle, ...(block.sourceStyle ? { paragraph: { ...block.sourceStyle, ...block.localStyle?.paragraph } } : {}) }, block.styleId) : '';
      if (format !== open) { close(); if (format) { lines.push(`:::format ${format}`); open = format; } }
      lines.push(blockSource(block, syntax, false));
    }
  }
  close(); return lines.join('\n');
}
function applySections(tree: DocumentTree, records: SourceBlock[]): DocumentTree {
  for (const section of tree.children) { delete section.start; delete section.styleId; delete section.localStyle; }
  const blocks = flattenDocument(tree);
  for (const [index, record] of records.entries()) if (record.section) {
    const section = tree.children.find(s => s.children[0]?.id === blocks[index]?.id);
    if (!section) throw new Error('章の書式は章見出しの直前に指定してください。');
    Object.assign(section, record.section);
  }
  return tree;
}
function treeFrom(blocks: TreeBlock[], previous?: DocumentTree): DocumentTree {
  let nextId = previous?.nextId ?? 1;
  const oldChapters = new Map(previous?.children.filter(s => s.headingId).map(s => [s.headingId, s]) ?? []), oldBody = previous?.children.find(s => s.role === 'body');
  for (const block of blocks) if (block.id.startsWith('p-')) block.id = `b-${nextId++}`;
  const sections: Section[] = [];
  for (const block of blocks) {
    if (!sections.length || block.kind === 'heading' && block.level === 1) {
      const headingId = block.kind === 'heading' && block.level === 1 ? block.id : undefined;
      const prior = headingId ? oldChapters.get(headingId) : oldBody;
      sections.push({ ...prior, kind: 'section', id: prior?.id ?? `s-${nextId++}`, role: headingId ? 'chapter' : 'body', ...(headingId ? { headingId } : {}), ...(prior?.start ? { start: prior.start } : {}), children: [] });
    }
    sections.at(-1)!.children.push(block);
  }
  if (!sections.length) sections.push({ kind: 'section', id: `s-${nextId++}`, role: 'body', children: [] });
  return { schemaVersion: 2, kind: 'document', title: previous?.title ?? '本文', author: previous?.author ?? '', nextId, children: sections };
}
export function createPublication(source: string, syntax: SourceSyntax = 'markdown'): Publication {
  const records = sourceBlocks(source, syntax), document = applySections(treeFrom(records.map(r => r.block)), records);
  return { schemaVersion: 3, source: syntax === 'markdown' ? source : sourceOf(document, 'markdown'), syntax: 'markdown', document, styles: defaultCatalog(), style: defaultStyle(), overrides: [], runningElements: [], specialPages: records.flatMap(r => r.block.kind === 'specialPage' ? [newSpecialPage(r.block.pageId, r.block.role)] : []), assets: [], pageOverrides: [] };
}
/** Linear reconciliation: exact anchors and unambiguous moves first, single edits between anchors second. */
export function updateSource(project: Publication, source: string, syntax: SourceSyntax = project.syntax): Publication {
  const records = sourceBlocks(source, syntax), old = flattenDocument(project.document), fresh = records.map(r => r.block), before = old.map(identityKey), after = fresh.map(identityKey);
  const oldCounts = new Map<string, number>(), newCounts = new Map<string, number>();
  for (const key of before) oldCounts.set(key, (oldCounts.get(key) ?? 0) + 1);
  for (const key of after) newCounts.set(key, (newCounts.get(key) ?? 0) + 1);
  const ambiguous = new Set([...oldCounts].filter(([key, count]) => Math.max(count, newCounts.get(key) ?? 0) > 1 && count !== (newCounts.get(key) ?? 0)).map(([key]) => key));
  const matches = new Map<number, number>(), used = new Set<number>();
  const match = (i: number, j: number) => { if (!ambiguous.has(before[i]!) && !ambiguous.has(after[j]!)) { matches.set(j, i); used.add(i); } };
  let prefix = 0;
  while (prefix < old.length && prefix < fresh.length && before[prefix] === after[prefix]) { match(prefix, prefix); prefix++; }
  let i = old.length - 1, j = fresh.length - 1;
  while (i >= prefix && j >= prefix && before[i] === after[j]) { match(i--, j--); }
  const oldByKey = new Map<string, number[]>(), newByKey = new Map<string, number[]>();
  for (let at = prefix; at <= i; at++) { const key = before[at]!; const positions = oldByKey.get(key) ?? []; positions.push(at); oldByKey.set(key, positions); }
  for (let at = prefix; at <= j; at++) { const key = after[at]!; const positions = newByKey.get(key) ?? []; positions.push(at); newByKey.set(key, positions); }
  for (const [key, positions] of newByKey) { const candidates = oldByKey.get(key); if (positions.length === 1 && candidates?.length === 1) match(candidates[0]!, positions[0]!); }
  const anchors: [number, number][] = [];
  for (let at = 0; at < fresh.length; at++) if (matches.has(at)) anchors.push([at, matches.get(at)!]);
  const ordered = [[-1, -1], ...anchors, [fresh.length, old.length]];
  for (let at = 1; at < ordered.length; at++) {
    const [newFrom, oldFrom] = ordered[at - 1]!, [newTo, oldTo] = ordered[at]!;
    if (newTo! - newFrom! === 2 && oldTo! - oldFrom! === 2 && !used.has(oldFrom! + 1)) {
      const oi = oldFrom! + 1, ni = newFrom! + 1;
      if (old[oi]?.kind === fresh[ni]?.kind && (old[oi]!.kind !== 'heading' || (old[oi] as { level: number }).level === (fresh[ni] as { level: number }).level)) match(oi, ni);
    }
  }
  for (const [at, previousAt] of matches) {
    const prior = old[previousAt]!;
    fresh[at] = { ...fresh[at]!, id: prior.id };
  }
  const specialPages = structuredClone(project.specialPages ?? []);
  for (const block of fresh) if (block.kind === 'specialPage' && !specialPages.some(p => p.id === block.pageId)) specialPages.push(newSpecialPage(block.pageId, block.role));
  const document = applySections(treeFrom(fresh, project.document), records);
  return { ...project, syntax: 'markdown', source: syntax === 'markdown' ? source : sourceOf(document, 'markdown'), document, specialPages };
}
export function validateTree(value: unknown): DocumentTree {
  object(value, ['schemaVersion', 'kind', 'title', 'author', 'nextId', 'children'], '文書構造');
  if (value.schemaVersion !== 2 || value.kind !== 'document' || !Array.isArray(value.children) || !value.children.length || value.children.length > MAX_SOURCE) throw new Error('未対応の文書構造です。');
  textValue(value.title, 200, '書名'); textValue(value.author, 200, '著者'); integer(value.nextId, '次のID', 1, 10_000_000);
  const ids = new Set<string>(); let total = 0, largestId = 0;
  const addId = (id: unknown) => { identifier(id); if (ids.has(id)) throw new Error('文書のIDが重複しています。'); ids.add(id); largestId = Math.max(largestId, Number(/^[bs]-(\d+)$/u.exec(id)?.[1] ?? 0)); };
  for (const [index, section] of value.children.entries()) {
    object(section, ['kind', 'id', 'role', 'headingId', 'start', 'styleId', 'localStyle', 'children'], 'セクション'); addId(section.id);
    if (section.styleId !== undefined) identifier(section.styleId);
    if (section.localStyle !== undefined) validateSection(section.localStyle);
    if (section.kind !== 'section' || !['body', 'chapter'].includes(section.role as string) || !Array.isArray(section.children) || !section.children.length || section.role === 'body' && index !== 0) throw new Error('未対応のセクションです。');
    if (section.headingId !== undefined) identifier(section.headingId);
    if (section.start !== undefined && !['continuous', 'next', 'left', 'right', 'recto'].includes(section.start as string)) throw new Error('章の開始条件を確認してください。');
    for (const block of section.children) {
      object(block, ['id', 'kind', 'inlines', 'indent', 'level', 'keepWithNext', 'start', 'role', 'sourceStyle', 'styleId', 'localStyle', 'pageId'], '文書要素'); addId(block.id);
      if (block.kind === 'specialPage') { object(block, ['id', 'kind', 'role', 'pageId'], '特殊ページの参照'); identifier(block.pageId); if (!SPECIAL_ROLES.includes(block.role as never)) throw new Error('特殊ページの役割を確認してください。'); continue; }
      if (block.styleId !== undefined) identifier(block.styleId);
      if (block.localStyle !== undefined) validateLocal(block.localStyle);
      if (block.sourceStyle !== undefined) { validateParagraph(block.sourceStyle); object(block.sourceStyle, ['alignment'], '原稿書式'); block.localStyle = { ...block.localStyle, paragraph: { ...block.sourceStyle, ...block.localStyle?.paragraph } }; delete block.sourceStyle; }
      if (block.role !== undefined && !['body', 'quote'].includes(block.role as string)) throw new Error('未対応の段落種別です。');
      if (block.kind === 'pageBreak') { object(block, ['id', 'kind', 'start'], '改ページ'); if (!['next', 'left', 'right', 'recto'].includes(block.start as string)) throw new Error('改ページの指定を確認してください。'); continue; }
      object(block, ['id', 'kind', 'inlines', 'role', 'sourceStyle', 'styleId', 'localStyle', ...(block.kind === 'heading' ? ['level', 'keepWithNext'] : ['indent'])], '段落');
      if (!['paragraph', 'heading'].includes(block.kind as string) || !Array.isArray(block.inlines)) throw new Error('未対応の文書要素です。');
      if (block.kind === 'heading') { integer(block.level, '見出し階層', 1, 6); if (block.keepWithNext !== true) throw new Error('見出しの分離はローカル書式で指定してください。'); }
      else if (block.indent !== 'auto') throw new Error('字下げはスタイルで指定してください。');
      for (const inline of block.inlines) {
        object(inline, ['kind', 'text', 'base', 'reading', 'emphasis', 'strong', 'styleId', 'localStyle'], '文字要素');
        if (inline.styleId !== undefined) identifier(inline.styleId); if (inline.localStyle !== undefined) validateCharacter(inline.localStyle);
        if (inline.kind === 'ruby') { object(inline, ['kind', 'base', 'reading', 'emphasis', 'strong', 'styleId', 'localStyle'], 'ルビ'); textValue(inline.base, MAX_SOURCE, '親文字'); textValue(inline.reading, MAX_SOURCE, '読み'); if (!inline.base || !inline.reading || /[|｜《\n]/u.test(inline.base) || /[》\n]/u.test(inline.reading)) throw new Error('ルビを確認してください。'); total += inline.base.length + inline.reading.length; }
        else if (inline.kind === 'text') { object(inline, ['kind', 'text', 'emphasis', 'strong', 'styleId', 'localStyle'], '本文文字'); textValue(inline.text, MAX_SOURCE, '本文'); if (/[\r\n]/u.test(inline.text)) throw new Error('改行は段落として保持してください。'); total += inline.text.length; }
        else throw new Error('未対応の文字要素です。');
        if (inline.emphasis !== undefined && !['sesame', 'dot', 'circle', 'triangle'].includes(inline.emphasis as string)) throw new Error('圏点を確認してください。');
        if (inline.strong !== undefined && inline.strong !== true) throw new Error('強調を確認してください。');
      }
    }
    const head = section.children.find(b => b.id === section.headingId);
    if (section.role === 'chapter' ? !head || head !== section.children[0] || head.kind !== 'heading' || head.level !== 1 : section.headingId !== undefined) throw new Error('章見出しの参照が一致しません。');
    if (section.children.some(b => b.kind === 'heading' && b.level === 1 && b !== head)) throw new Error('レベル1見出しは独立した章セクションとして保持してください。');
  }
  if (total > MAX_SOURCE || ids.size > MAX_SOURCE + value.children.length || (value.nextId as number) <= largestId) throw new Error('文書の容量・IDを確認してください。');
  return structuredClone(value as unknown as DocumentTree);
}
export function validatePublication(value: unknown): Publication {
  object(value, ['schemaVersion', 'syntax', 'source', 'document', 'styles', 'style', 'overrides', 'runningElements', 'metadata', 'specialPages', 'assets', 'pageOverrides', 'sourceDraft', 'printSettings'], 'プロジェクト');
  if (value.schemaVersion !== 3 || value.syntax !== 'markdown') throw new Error('未対応のプロジェクト形式です。');
  const syntax = value.syntax as 'markdown', documentTree = validateTree(value.document), styles = validateCatalog(value.styles), style = validateStyle(value.style);
  object(value.style, ['page', 'writingMode', 'binding', 'columns', 'columnGapMm', 'fontFamily', 'fontPt', 'lineHeight', 'margins', 'maxCharsPerLine', 'maxLinesPerPage', 'pageLayout', 'paragraphIndent', 'paperColor', 'textColor', 'folio', 'runningHeads', 'pageCountMultiple'], '本の組版設定');
  object(value.style.page, ['widthMm', 'heightMm'], '判型'); object(value.style.margins, ['topMm', 'bottomMm', 'innerMm', 'outerMm'], '余白');
  if (value.style.folio) {
    object(value.style.folio, ['enabled', 'fromPage', 'startNumber', 'position', 'fontFamily', 'fontPt', 'insetMm', 'rules'], 'ノンブル');
    for (const rule of value.style.folio.rules as unknown[]) object(rule, ['id', 'from', 'to', 'enabled', 'startNumber'], '番号範囲');
  }
  for (const head of (value.style.runningHeads ?? []) as unknown[]) object(head, ['id', 'from', 'to', 'side', 'position', 'text', 'fontFamily', 'fontPt', 'insetMm'], '既存の柱');
  validateDocumentReferences(documentTree, styles);
  if (!Array.isArray(value.overrides) || value.overrides.length > 200 || !Array.isArray(value.runningElements) || value.runningElements.length > 50) throw new Error('範囲指定は書式200件・柱50件以内にしてください。');
  const ids = new Set<string>();
  for (const rule of value.overrides) {
    object(rule, ['id', 'scope', 'paragraph', 'character', 'page', 'pageStyleId'], '範囲書式'); identifier(rule.id); validateScope(rule.scope);
    if (rule.scope.kind === 'pages') throw new Error('組版に影響する書式は章・段落の範囲で指定してください。ページ範囲は柱に使えます。');
    validateLocal({ ...(rule.paragraph !== undefined ? { paragraph: rule.paragraph } : {}), ...(rule.character !== undefined ? { character: rule.character } : {}), ...(rule.page !== undefined ? { page: rule.page } : {}), ...(rule.pageStyleId !== undefined ? { pageStyleId: rule.pageStyleId } : {}) });
    if (rule.pageStyleId && !styles.pages?.some(e => e.id === rule.pageStyleId)) throw new Error('版面スタイルが見つかりません。');
    if (ids.has(rule.id)) throw new Error('範囲指定IDが重複しています。'); ids.add(rule.id);
  }
  for (const element of value.runningElements) { validateRunningElement(element, style); if (ids.has(element.id)) throw new Error('範囲指定IDが重複しています。'); ids.add(element.id); }
  const blocks = flattenDocument(documentTree);
  const sectionKey = (s: Pick<Section, 'start' | 'styleId' | 'localStyle'> | undefined) => {
    const { page, paragraph, character, ...properties } = s?.localStyle ?? {}, attrs = { ...properties, ...(s?.start ? { start: s.start } : {}) };
    return JSON.stringify([s?.styleId ?? '', Object.entries(attrs).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')), formatAttributes({ ...(page ? { page } : {}), ...(paragraph ? { paragraph } : {}), ...(character ? { character } : {}) })]);
  };
  const expectedSections = documentTree.children.flatMap(s => s.children.map((_, index) => index === 0 ? sectionKey(s) : sectionKey(undefined)));
  const agrees = (source: string) => {
    try { const records = sourceBlocks(source, syntax); return JSON.stringify(records.map(r => contentKey(r.block))) === JSON.stringify(blocks.map(contentKey)) && (syntax !== 'markdown' || JSON.stringify(records.map(r => sectionKey(r.section))) === JSON.stringify(expectedSections)); }
    catch { return false; }
  };
  const source = typeof value.source === 'string' && value.source.length <= MAX_SOURCE && agrees(value.source) ? value.source : sourceOf(documentTree, syntax);
  if (source.length > MAX_SOURCE || !agrees(source)) throw new Error('文書構造を原稿に変換できません。未対応の要素を含む元データを保管してください。');
  const result: Publication = { schemaVersion: 3, syntax, source, document: documentTree, styles, style, overrides: structuredClone(value.overrides) as Publication['overrides'], runningElements: structuredClone(value.runningElements) as Publication['runningElements'] };
  if (value.schemaVersion === 3) {
    result.specialPages = validateSpecialPages(value.specialPages); result.assets = validateAssets(value.assets); result.pageOverrides = validatePageOverrides(value.pageOverrides);
    for (const p of result.specialPages) if (p.pageStyleId && !styles.pages?.some(e => e.id === p.pageStyleId)) throw new Error('特殊ページの版面スタイルが見つかりません。');
    const refs = new Set<string>();
    for (const b of blocks) if (b.kind === 'specialPage') { if (refs.has(b.pageId)) throw new Error('同じ特殊ページIDが複数配置されています。複製には別のIDを使ってください。'); refs.add(b.pageId); const p = result.specialPages.find(p => p.id === b.pageId); if (!p || p.role !== b.role) throw new Error('特殊ページの参照先が一致しません。'); }
    if (value.sourceDraft !== undefined) { textValue(value.sourceDraft, MAX_SOURCE, '未確定原稿'); result.sourceDraft = value.sourceDraft; }
  }
  if (value.printSettings !== undefined) result.printSettings = validatePrintSettings(value.printSettings);
  if (value.metadata !== undefined) {
    object(value.metadata, ['filename', 'viewMode', 'selected'], '表示設定'); const m = value.metadata; textValue(m.filename, 200, 'ファイル名');
    if (!['spread', 'single', 'gallery'].includes(m.viewMode as string)) throw new Error('表示設定を確認してください。');
    result.metadata = { filename: m.filename, viewMode: m.viewMode as 'spread' | 'single' | 'gallery', selected: integer(m.selected, '表示ページ') };
  }
  return result;
}

/** Source editing and JSON restoration share exactly the same reference contract. */
export function validateDocumentReferences(documentTree: DocumentTree, styles: StyleCatalog): void {
  for (const block of flattenDocument(documentTree)) if (block.kind !== 'pageBreak' && block.kind !== 'specialPage' && !(block.kind === 'heading' ? styles.headings : styles.paragraphs).some(s => s.id === blockStyleId(block))) throw new Error('文書のスタイル参照先が見つかりません。');
  for (const section of documentTree.children) {
    if (section.styleId && !styles.sections?.some(e => e.id === section.styleId)) throw new Error('章スタイルが見つかりません。');
    if (section.localStyle?.pageStyleId && !styles.pages?.some(e => e.id === section.localStyle?.pageStyleId)) throw new Error('版面スタイルが見つかりません。');
    if (section.localStyle?.paragraphStyleId && !styles.paragraphs.some(e => e.id === section.localStyle?.paragraphStyleId)) throw new Error('本文スタイルが見つかりません。');
  }
  for (const b of flattenDocument(documentTree)) {
    if (b.localStyle?.pageStyleId && !styles.pages?.some(e => e.id === b.localStyle?.pageStyleId)) throw new Error('版面スタイルが見つかりません。');
    if ('inlines' in b) for (const r of b.inlines) if (r.styleId && !styles.characters.some(e => e.id === r.styleId)) throw new Error('文字スタイルが見つかりません。');
  }
}
