import type { Diagnostic, Block, BookStyle, BookPage, FlowPage, FlowLine, Inline, RenderedPages, SpecialRenderedPage } from '../domain/contracts.js';
import { advance, geometry, graphemes, validateStyle } from '../domain/style.js';
import { matchesPageStart } from '../domain/page-order.js';
import { paginateAdvanced } from './flow.js';
import { wrapRuns as wrap } from './line-breaks.js';

type Run = Inline & { advanceEm: number };
const textOf = (run: Inline) => run.kind === 'text' ? run.text : run.base;
const width = (text: string) => graphemes(text).reduce((sum, g) => sum + advance(g), 0);
function atomsOf(inlines: readonly Inline[], capacity: number, warnRuby: () => void): Run[] {
  const atoms: Run[] = [];
  for (const run of inlines) {
    if (run.kind === 'text') { for (const glyph of graphemes(run.text)) atoms.push({ ...run, text: glyph, advanceEm: advance(glyph) }); continue; }
    const span = Math.max(width(run.base), width(run.reading) * .5);
    if (span <= capacity) { atoms.push({ ...run, advanceEm: span }); continue; }
    warnRuby();
    const base = graphemes(run.base), reading = graphemes(run.reading);
    let start = 0;
    while (start < base.length) {
      let end = start + 1;
      const part = (to: number) => ({ base: base.slice(start, to).join(''), reading: reading.slice(Math.floor(start * reading.length / base.length), Math.floor(to * reading.length / base.length)).join('') });
      while (end < base.length) { const next = part(end + 1); if (Math.max(width(next.base), width(next.reading) * .5) > capacity) break; end++; }
      const piece = part(end);
      atoms.push({ ...run, ...piece, advanceEm: Math.min(capacity, Math.max(width(piece.base), width(piece.reading) * .5)) }); start = end;
    }
  }
  return atoms;
}
export type PaginationBlock = (Block | { kind: 'specialPage'; id: string; page: Omit<SpecialRenderedPage, 'number'> }) & { layoutStyle?: BookStyle; sectionId?: string };
export function paginate(doc: { schemaVersion: 1; title: string; blocks: readonly PaginationBlock[] }, rawStyle: BookStyle): RenderedPages {
  if (rawStyle.fontFamily !== 'Book Mincho' || rawStyle.writingMode !== 'vertical-rl' || rawStyle.columns !== 1 || doc.blocks.some(b => b.layoutStyle || b.kind === 'specialPage' && b.page.imageInfo || 'inlines' in b && (b.insetEm || b.endInsetEm || b.beforeEm || b.afterEm || b.lineHeight || b.orphans || b.widows || b.inlines.some(r => r.fontFamily || r.fontPt || r.letterSpacingEm || r.orientation || r.numbers || r.emphasis === 'circle' || r.emphasis === 'triangle')))) return paginateAdvanced(doc.blocks, rawStyle);
  const style = validateStyle(rawStyle), grid = geometry(style), pages: BookPage[] = [], diagnostics: Diagnostic[] = [];
  const headingScale = Math.max(1, Math.min(1.15, (style.lineHeight - .04) / 1.51));
  let page: FlowPage = { kind: 'flow', number: 1, lines: [] }, column = 0, currentHeading = '', afterSpecial = false;
  const newPage = () => { pages.push(page); page = { kind: 'flow', number: pages.length + 1, lines: [], ...(currentHeading ? { heading: currentHeading } : {}) }; column = 0; };
  if (grid.chars < (style.maxCharsPerLine ?? grid.chars) || grid.lines < (style.maxLinesPerPage ?? grid.lines)) diagnostics.push({ code: 'grid-clamped', message: '用紙に収まる字数・行数へ調整しました。' });
  const wrappedBlocks = doc.blocks.map(block => {
    if (block.kind === 'pageBreak' || block.kind === 'specialPage') return [];
    const text = block.inlines.map(textOf).join(''), scale = block.kind === 'heading' ? headingScale : 1;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(text)) diagnostics.push({ code: 'control-character', blockId: block.id, message: '表示できない制御文字を可視記号で表示しています。原稿には元の文字を保持しています。' });
    const requestedIndent = block.indentEm ?? (block.kind === 'paragraph' && block.indent === 'auto' && style.paragraphIndent && !/^[\s　「『（【〈《‘“]/u.test(text) ? 1 : 0);
    const indent = Math.min(requestedIndent, Math.max(0, grid.chars / scale - 1));
    if (indent !== requestedIndent) diagnostics.push({ code: 'indent-clamped', blockId: block.id, message: '行に収まるよう字下げを小さくしました。字数か書式を調整してください。' });
    let warned = false;
    const atoms = atomsOf(block.inlines, grid.chars / scale, () => diagnostics.push({ code: 'ruby-split', blockId: block.id, message: '行より長いルビを、親文字と読みを保持して分割しました。長い読みは縮小して表示します。' }));
    return wrap(atoms, grid.chars / scale, indent, () => { if (!warned) diagnostics.push({ code: 'kinsoku-unresolved', blockId: block.id, message: '禁則または長い文字の並びを幅内で解決できない箇所があります。' }); warned = true; });
  });
  for (let index = 0; index < doc.blocks.length; index++) {
    const block = doc.blocks[index]!;
    if (block.kind === 'specialPage') {
      if (column > 0) newPage();
      pages.push({ ...block.page, number: pages.length + 1 });
      page = { kind: 'flow', number: pages.length + 1, lines: [], ...(currentHeading ? { heading: currentHeading } : {}) }; column = 0; afterSpecial = true;
      continue;
    }
    if (block.kind === 'pageBreak') {
      if (column > 0 || block.start === 'next' && !afterSpecial) newPage();
      afterSpecial = false;
      if (block.start !== 'next') {
        if (style.pageLayout === 'uniform') diagnostics.push({ code: 'uniform-page-start', blockId: block.id, message: '左右共通のページでは、左右からの開始指定を通常のページ開始として扱います。' });
        else if (!matchesPageStart(block.start, page.number, style)) newPage();
      }
      continue;
    }
    afterSpecial = false;
    const wrapped = wrappedBlocks[index]!;
    if (!wrapped.length) {
      if (index === doc.blocks.length - 1) continue;
      if (column >= grid.lines) newPage(); column++; continue;
    }
    if (block.kind === 'heading' || block.keepWithNext) {
      // Reserve the heading and at least the next nonempty paragraph's first line, when possible.
      const next = doc.blocks.slice(index + 1).find(b => b.kind !== 'paragraph' || b.inlines.length);
      const spaceAfter = block.kind === 'heading' && grid.lines >= 3 ? 1 : 0, needed = wrapped.length + spaceAfter + (next && next.kind !== 'pageBreak' && next.kind !== 'specialPage' ? 1 : 0);
      if (block.keepWithNext && needed <= grid.lines && grid.lines - column < needed) newPage();
      if (block.kind === 'heading') { currentHeading = block.inlines.map(textOf).join(''); page = { ...page, heading: currentHeading }; }
    }
    for (const line of wrapped) {
      if (column >= grid.lines) newPage();
      const next: FlowLine = { ...line, column: column++, blockId: block.id, ...(block.alignment ? { alignment: block.alignment } : {}), ...(block.kind === 'heading' ? { fontScale: headingScale, heading: true } : {}) };
      page = { ...page, lines: [...page.lines, next] };
    }
    if (block.kind === 'heading' && grid.lines >= 3 && column < grid.lines) column++;
  }
  // The empty continuation after a terminal special page is not an extra book page.
  if (!pages.length || column > 0 || doc.blocks.at(-1)?.kind === 'pageBreak' || pages.at(-1)?.kind === 'flow') pages.push(page);
  return { pages, diagnostics };
}
