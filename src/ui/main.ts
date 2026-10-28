import type { RenderedPages, ViewMode, BookPage } from '../domain/contracts.js';
import { MAX_SOURCE } from '../domain/document.js';
import type { BookModel } from '../domain/model.js';
import { createPublication, flattenDocument, validatePublication } from '../domain/publication.js';
import { asBook, editBookSource, sourceRangeFor } from '../domain/book.js';
import { SAMPLE } from '../domain/sample.js';
import { loadPageFonts } from '../io/fonts.js';
import { validateStyle, geometry } from '../domain/style.js';
import { adjacentPage, spreadPages } from '../domain/page-order.js';
import { sourceBlocks } from '../domain/source.js';
import { bookSourceMap, rawSourceOffsets, editorOffset, textSourceRange, sourceTextRanges, type TextSourceSpan } from '../domain/source-map.js';
import { pageElementMovement } from '../domain/editing.js';
import { renderPageSVG } from '../render/svg.js';
import { restoreBookDraft, saveBookDraft, preserveBookDraft, draftRecoveryState, DraftConflict } from '../io/book-draft.js';
import type { Draft } from '../io/draft.js';
import { importFile } from '../io/import.js';
import { el, input, setValue } from './dom.js';
import { settings } from './settings.js';
import { settingsPresetEditor } from './settings-presets.js';
import { output } from './output.js';
import { manuscriptTools, scrollToPosition } from './manuscript.js';
import { sourceSearch } from './source-search.js';
import { latestJob } from './latest-job.js';
import { blockInspector } from './inspector.js';
import { workspaceViews, selectedElementIds, type Selection } from './workspace.js';
import { catalogEditor } from './catalog.js';
import { workbenchShell } from './shell.js';
import { typographyEditor } from './typography.js';
import { layoutInput, resolveLayoutAssets, type LayoutPublication } from '../domain/layout-input.js';

const manuscript = el<HTMLTextAreaElement>('manuscript'), preview = el('preview-stage'), spread = el('book-spread'), panel = el('preview-panel'), workspace = el('workspace');
const worker = new Worker(new URL('../app/typesetter.worker.js', import.meta.url), { type: 'module' }), mobile = matchMedia('(max-width:760px)');
const layoutJobs = latestJob<{ revision: number; project: LayoutPublication }>(job => worker.postMessage(job));
const compact = matchMedia('(max-width:1100px)'); let explicitSpread = false;
const narrow = matchMedia('(min-width:761px) and (max-width:1199px)'); let hiddenPane: 'left' | 'right' | undefined;
let project = asBook(createPublication('', 'markdown')), source = project.source, style = project.style, filename = '無題', marginOffset = 0;
let viewMode: ViewMode = 'spread', selection: Selection = { kind: 'book' }, leftView = 'source', selected = 1, revision = 0, layoutRevision = -1;
let result: RenderedPages | undefined, canSave = true, restoring = true, importUndo: Draft | undefined, zoomed = false, previousPanel = 'manuscript', followSelection = false;
let inspectorMode: 'body' | 'styles' | 'selection' = 'body', normalWidth = '420px', normalRightOpen = true, editorWide = false;
let textAnchor: string | undefined;
let paperSourceSelection: { source: string; id: string; from: number; to: number; part: 'text' | 'reading' } | undefined;
let sourceMapCache: { source: string; document: BookModel['document']; spans: TextSourceSpan[]; editorOffsets: Uint32Array } | undefined;
let searchTools: ReturnType<typeof sourceSearch> | undefined, searchRange: { from: number; to: number } | undefined;
function sourceMap(): TextSourceSpan[] {
  if (project.sourceDraft !== undefined) return [];
  if (sourceMapCache?.source !== project.source || sourceMapCache.document !== project.document) sourceMapCache = { source: project.source, document: project.document, spans: bookSourceMap(project), editorOffsets: rawSourceOffsets(project.source, false) };
  return sourceMapCache.spans;
}
function editorRange(range: { from: number; to: number }): { from: number; to: number } {
  sourceMap(); const offsets = sourceMapCache!.editorOffsets; return { from: editorOffset(offsets, range.from), to: editorOffset(offsets, range.to) };
}
function sourceMatches(from: number, to: number): ReturnType<typeof sourceTextRanges> {
  const spans = sourceMap(), offsets = sourceMapCache?.editorOffsets; return offsets ? sourceTextRanges(spans, offsets[from] ?? from, offsets[to] ?? to) : [];
}
function revealSource(id: string, exact = true): void {
  if (project.sourceDraft !== undefined) { notify('入力中の原稿を確定してから、紙面から移動してください。'); return; }
  const chosen = paperSourceSelection, range = exact && chosen?.id === id && chosen.source === project.source ? textSourceRange(sourceMap(), id, chosen.from, chosen.to, chosen.part) : sourceRangeFor(project, id);
  if (!range) return; const display = editorRange(range); showLeft('source'); manuscript.focus(); manuscript.setSelectionRange(display.from, display.to); scrollToPosition(manuscript, display.from);
}
let importing = false, importSerial = 0;
let focusPanes: { left: boolean; right: boolean } | undefined;
let layoutTimer: ReturnType<typeof setTimeout> | undefined, saveTimer: ReturnType<typeof setTimeout> | undefined, saveQueue = Promise.resolve(), saveSerial = 0, lastEditAt = 0;
const history: Draft[] = [], future: Draft[] = [], selectedPages = new Set<number>(); let galleryAnchor = 1;
let galleryObserver: IntersectionObserver | undefined;

function notify(message: string, allowUndo = false, kind: 'info' | 'error' = allowUndo ? 'info' : 'error'): void { el('notice-text').textContent = message; el('notice').dataset.kind = kind; el('notice').hidden = false; el('undo-import').hidden = !allowUndo; }
function resumeAfterNotice(event: Event): void { const notice = el('notice'); if (notice.dataset.kind === 'info' && event.target instanceof Node && !notice.contains(event.target)) notice.hidden = true; }
document.addEventListener('pointerdown', resumeAfterNotice, true);
document.addEventListener('keydown', resumeAfterNotice, true);
function activePanel(name: string): void {
  if (name === 'output') { exports.open(); return; } previousPanel = name; document.body.dataset.activePanel = name;
  document.querySelectorAll<HTMLElement>('.mobile-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.target === name))); resizePaper(); if (name === 'preview') resetReadingPosition();
}
function saveWorkspace(): void {
  if (restoring) return;
  try { localStorage.setItem('bookmaker-workspace-v1', JSON.stringify({ leftView, leftOpen: hiddenPane === 'left' || workspace.dataset.leftOpen !== 'false', rightOpen: hiddenPane === 'right' || workspace.dataset.rightOpen !== 'false', leftWidth: workspace.style.getPropertyValue('--left-width'), rightWidth: workspace.style.getPropertyValue('--right-width'), editorWide, normalWidth, normalRightOpen })); } catch { /* Preferences never replace the book. */ }
}
function focusState(): void {
  const focused = !!focusPanes, button = el('focus-preview'); button.setAttribute('aria-pressed', String(focused));
  button.setAttribute('aria-label', focused ? '作業画面に戻る' : '紙面に集中'); button.title = focused ? '作業画面に戻る（Ctrl / Cmd + Shift + F）' : '紙面に集中（Ctrl / Cmd + Shift + F）';
  button.querySelector<HTMLElement>('[data-icon]')!.dataset.icon = focused ? 'minimize-2' : 'maximize-2';
}
function leaveFocus(): void {
  if (!focusPanes) return; workspace.dataset.leftOpen = String(focusPanes.left); workspace.dataset.rightOpen = String(focusPanes.right);
  for (const side of ['left', 'right'] as const) el(`toggle-${side}`).setAttribute('aria-expanded', String(workspace.dataset[`${side}Open`] !== 'false'));
  focusPanes = undefined; focusState();
}
function focusPaper(): void {
  if (mobile.matches) { activePanel('preview'); return; }
  if (focusPanes) leaveFocus();
  else { focusPanes = { left: workspace.dataset.leftOpen !== 'false', right: workspace.dataset.rightOpen !== 'false' }; workspace.dataset.leftOpen = 'false'; workspace.dataset.rightOpen = 'false'; for (const side of ['left', 'right']) el(`toggle-${side}`).setAttribute('aria-expanded', 'false'); focusState(); }
  resizePaper();
}
function openPane(side: 'left' | 'right', open: boolean): void {
  leaveFocus(); const other = side === 'left' ? 'right' : 'left';
  if (narrow.matches && open && workspace.dataset[`${other}Open`] !== 'false') { workspace.dataset[`${other}Open`]='false'; el(`toggle-${other}`).setAttribute('aria-expanded','false'); hiddenPane=other; }
  workspace.dataset[`${side}Open`] = String(open); el(`toggle-${side}`).setAttribute('aria-expanded', String(open));
  if (narrow.matches && !open && hiddenPane === other) { workspace.dataset[`${other}Open`]='true';el(`toggle-${other}`).setAttribute('aria-expanded','true');hiddenPane=undefined; }
  saveWorkspace(); resizePaper();
}
function showLeft(name: string): void {
  leftView = name; openPane('left', true);
  for (const v of ['structure', 'source', 'assets']) { el(`left-${v}`).hidden = v !== name; el(`tab-${v}`).setAttribute('aria-selected', String(v === name)); el(`tab-${v}`).tabIndex = v === name ? 0 : -1; }
  el('manuscript-heading').textContent = name === 'source' ? '原稿' : name === 'structure' ? '構成' : '素材';
  if (mobile.matches) activePanel('manuscript'); saveWorkspace();
}
const currentProject = (): BookModel => ({ ...project, style, metadata: { filename, viewMode, selected } });
const currentDraft = (): Draft => ({ schemaVersion: 3, project: currentProject(), marginOffset });
function syncSource(): void {
  source = project.sourceDraft ?? project.source;
  if (manuscript.value !== source) { const start = manuscript.selectionStart, end = manuscript.selectionEnd, scroll = manuscript.scrollTop; manuscript.value = source; manuscript.setSelectionRange(Math.min(start, source.length), Math.min(end, source.length)); manuscript.scrollTop = scroll; }
  el('sample-manuscript').hidden = !!source || !!project.assets.length;
  el('source-draft-status').hidden = project.sourceDraft === undefined; el('source-draft-status').textContent = project.sourceDraft !== undefined ? '指定を入力中' : '';
  el('character-count').textContent = `${Array.from(source).length.toLocaleString('ja-JP')} 字`; el('project-name').textContent = filename;
  const empty = project.source.length === 0; el('preview-empty').hidden = !empty; spread.hidden = empty; panel.dataset.empty = String(empty);
  setValue('book-title', project.document.title === '本文' ? '' : project.document.title); setValue('book-author', project.document.author);
  searchTools?.sync();
}
function applyDraft(draft: Draft): void { project = asBook(draft.project); style = project.style; marginOffset = draft.marginOffset; filename = project.metadata?.filename ?? '原稿'; viewMode = project.metadata?.viewMode ?? 'spread'; selected = project.metadata?.selected ?? 1; syncSource(); }
function syncHistory(): void { el<HTMLButtonElement>('undo').disabled = !history.length; el<HTMLButtonElement>('redo').disabled = !future.length; }
function snapshot(edit = false): void { if (!edit || Date.now() - lastEditAt > 800 || !history.length) { history.push(currentDraft()); if (history.length > 40) history.shift(); } future.length = 0; lastEditAt = edit ? Date.now() : 0; syncHistory(); }
function restoreHistory(back: boolean): void {
  const from = back ? history : future, to = back ? future : history, draft = from.pop(); if (!draft) return;
  const commonStyle = inspectorMode === 'styles';
  to.push(currentDraft()); applyDraft(draft); lastEditAt = 0; selection = { kind: 'book' }; inspectorMode = commonStyle ? 'styles' : 'body'; inspector.clear();
  if (canSave) el('notice').hidden = true; views.sync(true); reflow(); syncHistory();
}
// Invalidate an in-flight completion as soon as editing resumes, before the debounce runs.
function scheduleSave(): void { clearTimeout(saveTimer); if (!canSave || restoring) return; saveSerial++; el('save-state').textContent = '保存中…'; el('save-state').dataset.state = 'pending'; saveTimer = setTimeout(persistDraft, 500); }
function persistDraft(): void {
  clearTimeout(saveTimer); if (!canSave || restoring) return; const draft = currentDraft(), serial = ++saveSerial;
  saveQueue = saveQueue.then(async () => {
    if (!canSave) return;
    try { await saveBookDraft(draft, serial); if (serial === saveSerial) { el('save-state').textContent = '保存済み'; el('save-state').title = 'この端末に保存済み'; el('save-state').dataset.state = 'saved'; } }
    catch (error) { canSave = false; el('save-state').textContent = error instanceof DraftConflict ? '保存を停止' : '保存できません'; el('save-state').dataset.state = 'error'; notify(error instanceof DraftConflict ? error.message : '端末の保存領域に書き込めません。作業ファイル（JSON）も保存してください。'); }
  });
}
function preserveAndSave(): void { if (!canSave || restoring || el('save-state').dataset.state !== 'pending') return; try { preserveBookDraft(currentDraft(), ++saveSerial); } catch { /* The committed draft stays intact; the normal save reports capacity failures. */ } persistDraft(); }
window.addEventListener('pagehide', preserveAndSave); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') preserveAndSave(); });
const ready = () => !importing && !!result && revision === layoutRevision && project.sourceDraft === undefined;
const exports = output({
  state: () => ({ revision, diagnostics: result?.diagnostics ?? [], source: project.sourceDraft ?? source, project: currentProject(), filename, style, selected, viewMode, pages: result?.pages ?? [] }),
  ready: () => ready() && project.source.length > 0,
  rename(name) { filename = name; syncSource(); scheduleSave(); },
  printSettings(settings) { commit({ ...currentProject(), printSettings: settings }); },
  active(open) { document.querySelectorAll<HTMLElement>('.mobile-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.target === (open ? 'output' : previousPanel)))); },
  revealIssue(blockId,elementId,pageNumber) {
    const block = project.sourceDraft === undefined ? flattenDocument(project.document).find(b => b.id === blockId) : undefined;
    if (block?.kind === 'specialPage') {
      const definition=project.specialPages.find(p=>p.id===block.pageId);
      select({kind:'special',id:block.pageId,...(definition?.representation==='layout'&&elementId?{elementId}:{})}); followSelection = false;
      const page = result?.pages.find(p => p.kind !== 'flow' && p.pageId === block.pageId && (!pageNumber||p.number===pageNumber)); if(page) {selected=page.number;showPages();}
    } else {
      showLeft('source'); if (mobile.matches) activePanel('manuscript'); manuscript.focus();
      const range = blockId && project.sourceDraft === undefined ? sourceRangeFor(project, blockId) : undefined;
      if (range) {const display=editorRange(range);manuscript.setSelectionRange(display.from,display.to);scrollToPosition(manuscript,display.from);}
    }
  },
});
function commit(next: BookModel, message?: string): void {
  if (project.sourceDraft !== undefined) { notify('原稿の参照指定を完成させてから構成や書式を変更してください。入力内容は保存されています。'); return; }
  try { const valid = asBook(validatePublication(next)); snapshot(); project = valid; style = valid.style; followSelection = true; if (canSave) el('notice').hidden = true; syncSource(); reflow(); if (message) notify(message, false, 'info'); }
  catch (error) { notify(error instanceof Error ? error.message : '変更を適用できません。'); controls.sync(); inspector.sync(); views.sync(true); }
}
const controls = settings({ getStyle: () => style, update(next) {
  try { if (project.sourceDraft !== undefined) throw new Error('原稿の参照指定を完成させてから書式を変更してください。'); const valid = validateStyle(next); snapshot(); style = valid; project = currentProject(); reflow(); return true; }
  catch (error) { notify(error instanceof Error ? error.message : '組版設定を確認してください。'); controls.sync(); return false; }
}, getOffset: () => marginOffset, setOffset(v) { marginOffset = v; }, singleView() { viewMode = 'single'; }, selected: () => selected });
const inspector = blockInspector({ project: currentProject, update(next) { commit(asBook(next)); }, reveal() { openPane('right', true); if (mobile.matches) activePanel('settings'); }, scopeChanged(){views.sync();}, notify });
function select(value: Selection, reveal = true): void {
  selection = value; followSelection = true;
  if (value.kind === 'book') inspectorMode = 'body'; else if (reveal) inspectorMode = 'selection';
  if ((value.kind === 'block' || value.kind === 'range') && inspectorMode === 'selection') inspector.select(value.kind === 'range' ? value.ids : value.id,reveal); else inspector.clear();
  if (reveal) { openPane('right', true); if (mobile.matches) activePanel('settings'); }
  if (value.kind === 'special' && !project.specialPages.some(p => p.id === value.id) || value.kind === 'chapter' && !project.document.children.some(s => s.id === value.id) || value.kind === 'running' && !project.runningElements.some(r => r.id === value.id)) return;
  views.sync(); highlightElements();
}
const views = workspaceViews({ book: currentProject, result: () => result, selection: () => selection, inspectorMode: () => inspectorMode, textTarget:()=>inspector.target(), select, change: commit, notify, choosePage(n) { selected = n; showPages(); scheduleSave(); }, revealSource });
catalogEditor(el('catalog-editor'),{book:currentProject,change:commit});
settingsPresetEditor({ book: currentProject, change: commit, notify });
const typography = typographyEditor({ book: currentProject, change: commit });
function reflow(resetPage = false, save = true): void {
  if (resetPage) selected = 1; revision++; preview.dataset.inputRevision = String(revision); preview.dataset.layoutState = 'pending'; el('layout-pending').hidden = false;
  project = currentProject(); exports.sync(); controls.sync(); inspector.sync(); typography.sync(); syncSource(); views.sync();
  clearTimeout(layoutTimer); const nextRevision = revision; layoutTimer = setTimeout(() => layoutJobs.submit({ revision: nextRevision, project: layoutInput(currentProject()) }), 160); if (save) scheduleSave();
}
const single = () => mobile.matches || viewMode === 'single' || viewMode === 'spread' && compact.matches && !explicitSpread;
function resetReadingPosition(): void {
  if (viewMode === 'gallery') return;
  requestAnimationFrame(() => { preview.scrollTop = 0; if (!zoomed) { preview.scrollLeft = 0; return; } if (single()) preview.scrollLeft = preview.scrollWidth - preview.clientWidth; else { const paper = spread.querySelector<HTMLElement>(`[data-page-number="${selected}"]`); if (paper) preview.scrollLeft += paper.getBoundingClientRect().right - preview.getBoundingClientRect().right + 24; } });
}
function resizePaper(): void {
  const rect = preview.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const faces = single() ? 1 : 2, gap = style.pageLayout === 'uniform' ? 16 : 1, width = Math.max(30, Math.min(single() ? 450 : 420, (rect.width - (single() ? 30 : 48) - gap) / faces, (rect.height - 40) * style.page.widthMm / style.page.heightMm));
  spread.style.setProperty('--paper-width', `${width * (zoomed ? 1.8 : 1)}px`); spread.style.setProperty('--paper-ratio', String(style.page.heightMm / style.page.widthMm));
}
function chooseGallery(n: number, extend: boolean, additive: boolean): void {
  if (extend) { if (!additive) selectedPages.clear(); for (let p = Math.min(n, galleryAnchor); p <= Math.max(n, galleryAnchor); p++) selectedPages.add(p); }
  else { if (!additive) selectedPages.clear(); if (additive && selectedPages.has(n)) selectedPages.delete(n); else selectedPages.add(n); galleryAnchor = n; }
  inspectorMode = selectedPages.size ? 'selection' : 'body'; selected = n; select({ kind: 'pages', numbers: [...selectedPages].sort((a, b) => a - b) }, !mobile.matches); showPages(); scheduleSave();
}
function selectPaper(page: BookPage, event?: MouseEvent): void {
  selected = page.number; const target = event?.target instanceof Element ? event.target : undefined, running = target?.closest('[data-running-element]')?.getAttribute('data-running-element'), folio = target?.closest('[data-testid="folio"]');
  const glyph = target?.closest('[data-text-from]'), blockId = glyph?.closest('[data-block-id]')?.getAttribute('data-block-id');
  paperSourceSelection = glyph && blockId ? { source: project.source, id: blockId, from: Number(glyph.getAttribute('data-text-from')), to: Number(glyph.getAttribute('data-text-to')), part: glyph.hasAttribute('data-ruby') ? 'reading' : 'text' } : undefined;
  el<HTMLButtonElement>('open-paper-source').disabled = project.sourceDraft !== undefined || !blockId;
  if (running && project.runningElements.some(e => e.id === running)) select({ kind: 'running', id: running }, false);
  else if (folio) { select({ kind: 'book' }); el<HTMLDetailsElement>('detail-folio').open = true; input('folio-enabled').focus(); }
  else if (page.kind !== 'flow') { const elementId = target?.closest('[data-element-id]')?.getAttribute('data-element-id'); if(page.kind==='layout'&&elementId)selectCanvasElement(page.pageId,elementId,!!event?.shiftKey);else select({kind:'special',id:page.pageId},false); }
  else { const id = target?.closest('[data-block-id]')?.getAttribute('data-block-id'),ref=flattenDocument(project.document).find(b=>b.id===id); if(ref?.kind==='specialPage')select({kind:'special',id:ref.pageId},false);else if (id) {
    const blocks = flattenDocument(project.document), from = blocks.findIndex(b => b.id === textAnchor), to = blocks.findIndex(b => b.id === id);
    if (event?.shiftKey && from >= 0) select({ kind: 'range', ids: blocks.slice(Math.min(from, to), Math.max(from, to) + 1).filter(b => 'inlines' in b).map(b => b.id) }, false);
    else { textAnchor = id; select({ kind: 'block', id }, false); }
  } else select({ kind: 'pages', numbers: [page.number] }, false); } scheduleSave();
}
function selectCanvasElement(pageId:string,id:string,toggle=false):void {
  inspectorMode='selection';
  const previous=selection.kind==='special'&&selection.id===pageId?selectedElementIds(selection):[];
  const ids=toggle?previous.includes(id)?previous.filter(x=>x!==id):[...previous,id]:previous.length>1&&previous.includes(id)?previous:[id];
  select({kind:'special',id:pageId,...(ids[0]?{elementId:ids.includes(id)?id:ids[0],...(ids.length>1?{elementIds:ids}:{})}:{})},false);
}
function renderPaperContents(paper: HTMLElement, page: BookPage): void {
  paper.innerHTML = renderPageSVG(page, style);
  const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'paper-select sr-only'; choose.tabIndex = -1; choose.textContent = `${page.number}ページを選択`; paper.append(choose);
}
function paperFor(page: BookPage | undefined, side: string, lazy = false): HTMLElement {
  const paper = document.createElement('div'); paper.className = `paper${page ? '' : ' blank'}`; paper.dataset.side = side;
  if (page) {
    paper.dataset.pageNumber = String(page.number); if (!lazy) renderPaperContents(paper, page); paper.setAttribute('role', 'group'); paper.setAttribute('aria-roledescription', '紙面'); paper.setAttribute('aria-describedby', 'paper-selection-help'); paper.tabIndex = 0; paper.setAttribute('aria-label', `${page.number}ページ`);
    paper.addEventListener('click', e => { if (paper.dataset.dragged === 'true') { delete paper.dataset.dragged; return; } if (viewMode === 'gallery') chooseGallery(page.number, e.shiftKey, e.ctrlKey || e.metaKey); else selectPaper(page, e); });
    paper.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (viewMode === 'gallery') chooseGallery(page.number, e.shiftKey, e.ctrlKey || e.metaKey); else selectPaper(page); } });
    paper.addEventListener('dblclick', e => { const target = e.target instanceof Element ? e.target : undefined, id = target?.closest('[data-text-from]')?.closest('[data-block-id]')?.getAttribute('data-block-id'); if (id && viewMode !== 'gallery') revealSource(id); });
    if (page.kind === 'layout' && viewMode !== 'gallery') attachDrag(paper, page);
  } else paper.setAttribute('aria-hidden', 'true'); return paper;
}
function highlightElements(): void {
  highlightSourceMatch();
  spread.querySelectorAll('.selected-element-box').forEach(e => e.remove()); spread.querySelectorAll<HTMLElement>('.paper').forEach(e => { delete e.dataset.editing; });
  const layout = result?.pages[selected - 1]; el('free-page-tools').hidden = layout?.kind !== 'layout';
  for (const b of el('free-page-tools').querySelectorAll<HTMLButtonElement>('[data-canvas-action]')) b.disabled = selection.kind !== 'special' || !selection.elementId;
  const canvasSelection=selection,ids=selectedElementIds(canvasSelection),definition=canvasSelection.kind==='special'?project.specialPages.find(p=>p.id===canvasSelection.id):undefined,locked=!!ids.length&&ids.every(id=>definition?.elements.find(e=>e.id===id)?.locked),lock=el('free-page-tools').querySelector<HTMLButtonElement>('[data-canvas-action="lock"]')!;lock.textContent=locked?'固定を解除':'固定';lock.setAttribute('aria-pressed',String(locked));
  if (selection.kind !== 'special') return; const chosen = selection, p = project.specialPages.find(p => p.id === chosen.id);
  for (const paper of spread.querySelectorAll<HTMLElement>('.paper')) {
    const page = result?.pages[Number(paper.dataset.pageNumber) - 1]; if (!page || page.kind === 'flow' || page.pageId !== chosen.id || p?.representation !== 'layout') continue;
    paper.dataset.editing = 'true'; const ids=selectedElementIds(chosen);
    for(const e of p.elements.filter(e=>ids.includes(e.id))){
    const box = document.createElement('div'); box.className = 'selected-element-box';
    Object.assign(box.style, { left: `${e.xMm / style.page.widthMm * 100}%`, top: `${e.yMm / style.page.heightMm * 100}%`, width: `${e.widthMm / style.page.widthMm * 100}%`, height: `${e.heightMm / style.page.heightMm * 100}%` });
    if (!e.locked&&ids.length===1) for (const edge of ['e', 's', 'se']) { const handle = document.createElement('span'); handle.className = `element-handle handle-${edge}`; handle.dataset.resizeElement = e.id; handle.dataset.edge = edge; handle.setAttribute('aria-hidden', 'true'); box.append(handle); }
    box.dataset.locked = String(!!e.locked); paper.append(box);
    }
  }
}
function attachDrag(paper: HTMLElement, page: Exclude<BookPage, { kind: 'flow' }>): void {
  paper.addEventListener('pointerdown', event => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-resize-element]'), id = handle?.dataset.resizeElement ?? (event.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id'), element = project.specialPages.find(p => p.id === page.pageId)?.elements.find(e => e.id === id);
    if (!id || !element || project.sourceDraft !== undefined || event.button !== 0 || element.locked || event.shiftKey) return;
    if (handle) {
      const rect = paper.getBoundingClientRect(), startX = event.clientX, startY = event.clientY, edge = handle.dataset.edge; let width = element.widthMm, height = element.heightMm, moved = false;
      paper.setPointerCapture(event.pointerId); event.preventDefault();
      const move = (e: PointerEvent) => { moved = true; if (edge !== 's') width = Math.max(.1, Math.min(style.page.widthMm - element.xMm, element.widthMm + (e.clientX - startX) / rect.width * style.page.widthMm)); if (edge !== 'e') height = Math.max(.1, Math.min(style.page.heightMm - element.yMm, element.heightMm + (e.clientY - startY) / rect.height * style.page.heightMm)); const box = paper.querySelector<HTMLElement>('.selected-element-box')!; box.style.width = `${width / style.page.widthMm * 100}%`; box.style.height = `${height / style.page.heightMm * 100}%`; };
      const end = (e: PointerEvent) => { paper.removeEventListener('pointermove', move); paper.removeEventListener('pointerup', end); paper.removeEventListener('pointercancel', cancel); if(e.type==='pointerup')paper.dataset.dragged='true'; if (moved) views.resizeElement(page.pageId, id, width, height); };
      const cancel = (e: PointerEvent) => { moved = false; end(e); highlightElements(); };
      paper.addEventListener('pointermove', move); paper.addEventListener('pointerup', end); paper.addEventListener('pointercancel', cancel); return;
    }
    const rect = paper.getBoundingClientRect(), startX = event.clientX, startY = event.clientY; let deltaX=0,deltaY=0,moved = false;
    inspectorMode = 'selection';
    selectCanvasElement(page.pageId,id);const ids=selectedElementIds(selection),targets=[...paper.querySelectorAll<SVGElement>('[data-element-id]')].filter(e=>ids.includes(e.getAttribute('data-element-id')!)&&!project.specialPages.find(p=>p.id===page.pageId)!.elements.find(item=>item.id===e.getAttribute('data-element-id'))?.locked);paper.focus({ preventScroll: true });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const dx = (e.clientX - startX) / rect.width * style.page.widthMm, dy = (e.clientY - startY) / rect.height * style.page.heightMm; if (Math.abs(dx) + Math.abs(dy) < .7 && !moved) return;
      if (!moved) paper.setPointerCapture(event.pointerId); moved = true;
      const delta=pageElementMovement(currentProject(),page.pageId,ids,dx,dy);deltaX=delta.dx;deltaY=delta.dy;
      for(const target of targets)target.setAttribute('transform',`translate(${deltaX} ${deltaY})`);paper.querySelectorAll('.selected-element-box').forEach(e=>e.remove());
    };
    const end = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); if(e.type==='pointerup'&&e.target instanceof Node&&paper.contains(e.target))paper.dataset.dragged='true'; if (moved) views.moveElements(page.pageId, ids, deltaX, deltaY); };
    const cancel = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; moved = false;for(const target of targets)target.removeAttribute('transform'); end(e); highlightElements(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel); event.preventDefault();
  });
  paper.addEventListener('dblclick', event => { const id = (event.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id'), element = project.specialPages.find(p => p.id === page.pageId)?.elements.find(e => e.id === id); if (!id || element?.kind !== 'text' || element.locked) return; select({ kind: 'special', id: page.pageId, elementId: id }); el<HTMLTextAreaElement>('element-text').focus(); });
  paper.addEventListener('keydown', event => {
    if(event.isComposing)return;
    const s = selection; if (s.kind !== 'special' || s.id !== page.pageId) return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();const ids=project.specialPages.find(p=>p.id===s.id)!.elements.map(e=>e.id);if(ids[0])select({kind:'special',id:s.id,elementId:ids[0],elementIds:ids},false);return;}
    if (event.key === 'Escape') { event.preventDefault(); select({ kind: 'special', id: page.pageId }, false); return; }
    if (!s.elementId) return;
    const element = project.specialPages.find(p => p.id === s.id)?.elements.find(e => e.id === s.elementId); if (!element) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); views.elementAction('duplicate'); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); views.elementAction('delete'); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault();const step = event.shiftKey ? 10 : 1,dx=event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0,dy=event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0,ids=selectedElementIds(s);if(ids.length>1){if(project.specialPages.find(p=>p.id===s.id)!.elements.some(e=>ids.includes(e.id)&&!e.locked))views.moveElements(s.id,ids,dx,dy);}else if(!element.locked)views.moveElement(s.id,s.elementId,element.xMm+dx,element.yMm+dy); }
    else if (event.key === 'Tab') { const elements = project.specialPages.find(p => p.id === s.id)!.elements, at = elements.findIndex(e => e.id === s.elementId), next = elements[(at + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]; if (next) { event.preventDefault(); select({ kind: 'special', id: s.id, elementId: next.id }, false); } }
  });
}
function showPages(): void {
  const paperFocused = document.activeElement instanceof HTMLElement && !!document.activeElement.closest('.paper');
  if (!result) return; selected = Math.min(Math.max(1, selected), result.pages.length);
  const pair = spreadPages(selected, result.pages.length, style.binding), gallery = viewMode === 'gallery', numbers = gallery ? result.pages.map(p => p.number) : single() ? [selected] : [pair.left, pair.right];
  panel.dataset.binding = style.binding; panel.dataset.view = gallery ? 'gallery' : single() ? 'single' : 'spread'; panel.dataset.layout = style.pageLayout ?? 'book'; panel.dataset.zoom = String(!gallery && zoomed);
  for (const [id, mode] of [['view-single', 'single'], ['view-spread', 'spread'], ['view-gallery', 'gallery']] as const) el(id).setAttribute('aria-pressed', String(gallery ? mode === 'gallery' : single() ? mode === 'single' : mode === 'spread'));
  el('preview-zoom').hidden = gallery; el('previous-arrow').dataset.icon = single() ? 'chevron-up' : style.binding === 'left' ? 'chevron-left' : 'chevron-right'; el('next-arrow').dataset.icon = single() ? 'chevron-down' : style.binding === 'left' ? 'chevron-right' : 'chevron-left'; el('page-navigation').dataset.binding = style.binding; el('page-navigation').dataset.direction = single() ? 'vertical' : 'horizontal';
  el('preview-purpose').textContent = gallery ? 'Shiftで連続選択 · Ctrl / Cmdで追加選択' : style.pageLayout === 'uniform' ? '全ページ共通の版面' : single() ? '一枚ずつ、下へ進む' : style.binding === 'left' ? '左綴じ · 次のページへは右に' : '右綴じ · 次のページへは左に';
  const oldScroll = preview.scrollTop; galleryObserver?.disconnect(); spread.replaceChildren();
  if (gallery) galleryObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { const paper = entry.target as HTMLElement, page = result?.pages[Number(paper.dataset.pageNumber) - 1]; if (page) renderPaperContents(paper, page); galleryObserver?.unobserve(paper); }
  }, { root: preview, rootMargin: '250px' });
  for (const [i, number] of numbers.entries()) {
    const page = number === null ? undefined : result.pages[number - 1];
    if (gallery && page) {
      const item = document.createElement('div'); item.className = 'gallery-item'; item.dataset.selected = String(selectedPages.has(number!)); item.dataset.pageNumber = String(number);
      const paper = paperFor(page, 'single', true), caption = document.createElement('label'); caption.className = 'gallery-caption'; const box = document.createElement('input'); box.type = 'checkbox'; box.checked = selectedPages.has(number!); box.setAttribute('aria-label', `通しページ${number}を追加選択`); box.addEventListener('change', () => chooseGallery(number!, false, true)); caption.append(document.createTextNode(`p.${number}`), box); item.append(paper, caption); spread.append(item); galleryObserver?.observe(paper);
    } else spread.append(paperFor(page, i === 0 ? 'left' : 'right'));
  }
  el('page-count').textContent = String(result.pages.length); input('page-select').value = String(selected); input('page-select').max = String(result.pages.length);
  el('workbench-page-count').textContent = project.source.length ? `${result.pages.length} ページ` : '';
  const visibleStyle=result.pages[selected-1]?.style??style,grid=geometry(visibleStyle);el('layout-info').textContent=`${visibleStyle.writingMode==='vertical-rl'?'縦書き':'横書き'} · ${grid.chars}字 × ${grid.lines}行${visibleStyle.columns===2?' × 2段':''}`;
  el<HTMLButtonElement>('previous-page').disabled = selected <= 1; el<HTMLButtonElement>('next-page').disabled = selected >= result.pages.length || (!single() && Math.max(pair.left ?? 0, pair.right ?? 0) === result.pages.length);
  resizePaper(); if (gallery) preview.scrollTop = oldScroll; else resetReadingPosition(); exports.sync(); highlightElements(); views.sync();
  if (paperFocused) spread.querySelector<HTMLElement>(`[data-page-number="${selected}"]`)?.focus({ preventScroll: true });
}
worker.onmessage = async (event: MessageEvent<{ revision: number; result?: RenderedPages; error?: string }>) => {
  const response = event.data; layoutJobs.complete(response.revision); if (response.revision !== revision) return;
  if (!response.result) { preview.dataset.layoutState = 'error'; el('layout-pending').hidden = true; notify(response.error ?? '組版に失敗しました。'); return; }
  try { await loadPageFonts(response.result.pages,style); } catch (error) { preview.dataset.layoutState = 'error'; el('layout-pending').hidden = true; notify(error instanceof Error ? error.message : 'フォントを読み込めません。'); return; }
  if (response.revision !== revision) return; result = resolveLayoutAssets(response.result, project); layoutRevision = response.revision;
  if (followSelection) {
    const chosen = selection, ids = chosen.kind === 'chapter' ? new Set(project.document.children.find(s => s.id === chosen.id)?.children.map(b => b.id) ?? []) : undefined;
    const ref=chosen.kind==='special'?flattenDocument(project.document).find(b=>b.kind==='specialPage'&&b.pageId===chosen.id)?.id:undefined;
    const page = result.pages.find(p => chosen.kind === 'special' ? p.kind !== 'flow' ? p.pageId === chosen.id : p.elements?.some(e=>e.blockId===ref) : chosen.kind === 'block' ? p.lines.some(l => l.blockId === chosen.id) : ids ? p.lines.some(l => ids.has(l.blockId)) : false);
    if (page) selected = page.number; followSelection = false;
  }
  showPages(); preview.dataset.layoutRevision = String(layoutRevision); preview.dataset.layoutState = importing ? 'importing' : project.sourceDraft === undefined ? 'ready' : 'draft'; el('layout-pending').hidden = !importing;
  const messages = [...new Set(result.diagnostics.map(d => d.message))]; el('diagnostics').textContent = messages.join(' '); el('diagnostics').hidden = !messages.length; exports.sync();
};
worker.onerror = () => { layoutJobs.clear(); notify('組版処理を起動できません。ページを再読み込みしてください。'); preview.dataset.layoutState = 'error'; };
function edited(): void {
  if (manuscript.value.length > MAX_SOURCE) { manuscript.value = source; notify('原稿は50万文字まで扱えます。分けて読み込んでください。'); return; }
  snapshot(true); const styled = flattenDocument(project.document).filter(b => b.styleId || b.localStyle), edit = editBookSource(project, manuscript.value); project = edit.book;
  if (edit.error) notify(edit.error); else { if (canSave) el('notice').hidden = true; const currentIds = new Set(flattenDocument(project.document).map(b => b.id)); if (styled.some(b => !currentIds.has(b.id))) notify('編集後の段落へ対応づけられない書式がありました。別の段落へは移していません。必要なら「元に戻す」で確認してください。'); }
  const chosen = selection;
  if (!edit.error && (chosen.kind === 'block' && !flattenDocument(project.document).some(b => b.id === chosen.id) || chosen.kind === 'chapter' && !project.document.children.some(s => s.id === chosen.id) || chosen.kind === 'special' && !flattenDocument(project.document).some(b => b.kind === 'specialPage' && b.pageId === chosen.id))) select({ kind: 'book' }, false);
  if(!edit.error&&chosen.kind==='range'){const existing=new Set(flattenDocument(project.document).filter(b=>'inlines'in b).map(b=>b.id)),ids=chosen.ids.filter(id=>existing.has(id));if(ids.length!==chosen.ids.length)select(ids.length>1?{kind:'range',ids}:ids[0]?{kind:'block',id:ids[0]}:{kind:'book'},false);}
  importUndo = undefined; el('undo-import').hidden = true; reflow();
}
manuscript.addEventListener('input', edited); manuscriptTools(manuscript, edited, notify, () => openCommonStyles(), formatSelection);
function highlightSourceMatch(): void {
  spread.querySelectorAll('[data-search-hit]').forEach(node => node.removeAttribute('data-search-hit'));
  if (!searchRange || project.sourceDraft !== undefined) return;
  const ranges = sourceMatches(searchRange.from, searchRange.to);
  for (const node of spread.querySelectorAll('[data-text-from]')) {
    const id = node.closest('[data-block-id]')?.getAttribute('data-block-id'), from = Number(node.getAttribute('data-text-from')), to = Number(node.getAttribute('data-text-to'));
    if (ranges.some(range => range.blockId === id && range.to > from && range.from < to)) node.setAttribute('data-search-hit', 'true');
  }
}
searchTools = sourceSearch(manuscript, { showSource: () => showLeft('source'), notify, changed() { lastEditAt = 0; edited(); lastEditAt = 0; }, reveal(from, to, showPaper = false) {
  searchRange = from < 0 ? undefined : { from, to };
  if (searchRange && project.sourceDraft === undefined) {
    const ranges = sourceMatches(from, to), page = result?.pages.find(p => p.lines.some(line => ranges.some(range => range.blockId === line.blockId && line.runs.some(run => (run.textTo ?? -1) > range.from && (run.textFrom ?? Infinity) < range.to))));
    if (page && selected !== page.number) { selected = page.number; showPages(); }
  }
  highlightSourceMatch(); if (showPaper) { if (mobile.matches) activePanel('preview'); else panel.focus(); }
} });
el('open-paper-source').addEventListener('click', () => { if (paperSourceSelection) revealSource(paperSourceSelection.id); });
function formatSelection(): void {
  if (project.sourceDraft !== undefined) { notify('原稿の参照を確定してから段落を選んでください。'); return; }
  const raw = rawSourceOffsets(manuscript.value), ranges = sourceBlocks(manuscript.value, project.syntax).map(r => ({ ...r, from: raw[r.from]!, to: raw[r.to]! })), at = manuscript.selectionStart, end = manuscript.selectionEnd, all = flattenDocument(project.document);
  const indices = ranges.map((r, i) => at === end ? at >= r.from && at <= r.to ? i : -1 : r.to >= at && r.from < end ? i : -1).filter(i => i >= 0);
  const ids = indices.map(i => all[i]).filter((b): b is typeof all[number] => !!b && 'inlines' in b).map(b => b.id);
  if (ids.length > 1) { select({ kind: 'range', ids }); return; }
  const index = indices[0] ?? ranges.findIndex(r => r.from >= at), block = all[index];
  if (block?.kind === 'pageBreak') notify('改ページには段落書式を設定しません。'); else if (block?.kind === 'specialPage') select({ kind: 'special', id: block.pageId }); else if (block) select({ kind: 'block', id: block.id }); else notify('書式を変える段落にカーソルを置いてください。');
}
el('select-block-style').addEventListener('click', formatSelection);
el('import-trigger').addEventListener('click', () => input('manuscript-file').click());
async function readManuscript(file: File): Promise<void> {
  const atRevision = revision, operation = ++importSerial; importing = true; preview.dataset.layoutState = 'importing'; el('layout-pending').hidden = false; el('layout-pending').textContent = '読み込み中…'; input('manuscript-file').setAttribute('aria-busy', 'true'); exports.sync();
  try {
    const imported = await importFile(file); if (operation !== importSerial) return; if (atRevision !== revision) { notify('読み込み中に作業が変更されました。上書きせず読み込みを中止しました。'); return; }
    importUndo = currentDraft(); snapshot(); filename = file.name.replace(/(?:\.book)?\.[^.]+$/u, '').slice(0, 180) || '原稿'; selected = 1;
    project = asBook(imported.project ?? { ...createPublication(imported.source, imported.syntax), style });
    if (imported.project) { style = project.style; filename = project.metadata?.filename ?? filename; viewMode = project.metadata?.viewMode ?? 'spread'; selected = project.metadata?.selected ?? 1; marginOffset = 0; }
    selection = { kind: 'book' }; inspectorMode = 'body'; inspector.clear(); views.sync(true); syncSource(); notify(`${file.name} を読み込みました。${imported.format === 'UTF-8' ? '' : ` ${imported.format}。`} ${imported.warnings.join(' ')}`, true); reflow();
  } catch (error) { if (operation === importSerial) notify(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。'); } finally {
    if (operation === importSerial) { importing = false; input('manuscript-file').value = ''; input('manuscript-file').removeAttribute('aria-busy'); el('layout-pending').textContent = '組版中…'; const complete = !!result && revision === layoutRevision; preview.dataset.layoutState = complete ? project.sourceDraft === undefined ? 'ready' : 'draft' : 'pending'; el('layout-pending').hidden = complete; exports.sync(); }
  }
}
input('manuscript-file').addEventListener('change', () => { const file = input('manuscript-file').files?.[0]; if (file) void readManuscript(file); });
const dropArea = el('left-source');
dropArea.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; dropArea.dataset.dragging = 'true'; } });
dropArea.addEventListener('dragleave', event => { if (!(event.relatedTarget instanceof Node && dropArea.contains(event.relatedTarget))) delete dropArea.dataset.dragging; });
dropArea.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return; event.preventDefault(); delete dropArea.dataset.dragging;
  if (event.dataTransfer.files.length !== 1) { notify('原稿ファイルは一つずつ読み込んでください。'); return; }
  void readManuscript(event.dataTransfer.files[0]!);
});
// Dropping a file outside the import area must never navigate away and lose the book.
for (const name of ['dragover', 'drop']) window.addEventListener(name, event => { if ((event as DragEvent).dataTransfer?.types.includes('Files')) event.preventDefault(); });
el('undo-import').addEventListener('click', () => { if (!importUndo) return; snapshot(); applyDraft(importUndo); importUndo = undefined; selection = { kind: 'book' }; inspectorMode = 'body'; inspector.clear(); views.sync(true); el('notice').hidden = true; reflow(); });
el('dismiss-notice').addEventListener('click', () => { el('notice').hidden = true; });
el('undo').addEventListener('click', () => restoreHistory(true)); el('redo').addEventListener('click', () => restoreHistory(false));
document.addEventListener('keydown', e => { if (!e.isComposing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement && e.target !== manuscript)) { e.preventDefault(); restoreHistory(!e.shiftKey); } });
for (const id of ['inspect-book', 'edit-project-information']) el(id).addEventListener('click', () => {
  inspectorMode = 'body'; inspector.clear(); openPane('right', true); views.sync(); el('book-settings').parentElement!.scrollTop = 0;
  if (mobile.matches) activePanel('settings'); if (id === 'edit-project-information') { el<HTMLDetailsElement>('project-information').open = true; input('book-title').focus(); input('book-title').scrollIntoView({ block: 'center' }); }
});
const fileMenu = el('file-menu');
fileMenu.addEventListener('click',event=>{if((event.target as Element).closest('button'))fileMenu.hidePopover();});
fileMenu.addEventListener('beforetoggle', event => {
  if ((event as ToggleEvent).newState !== 'open') return;
  const bounds = el('project-home').getBoundingClientRect();
  fileMenu.style.left = Math.max(12, Math.min(bounds.left, innerWidth - Math.min(280, innerWidth - 24) - 12)) + 'px';
  fileMenu.style.top = bounds.bottom + 6 + 'px';
});
fileMenu.addEventListener('keydown',event=>{
  const items=[...fileMenu.querySelectorAll<HTMLButtonElement>('button')],at=items.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]!.focus();}
});
el('project-home').addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();fileMenu.showPopover();el('file-new').focus();}});
el('file-open').addEventListener('click',()=>input('manuscript-file').click());
el('file-save').addEventListener('click',()=>{void exports.saveProject();});
el('file-new').addEventListener('click',()=>el<HTMLDialogElement>('new-project-dialog').showModal());
el('close-new-project').addEventListener('click',()=>el<HTMLDialogElement>('new-project-dialog').close());
el('confirm-new-project').addEventListener('click',async()=>{
  el<HTMLDialogElement>('new-project-dialog').close(); await exports.saveProject(true);
});
el('start-new-project').addEventListener('click',()=>{
  if(!exports.canStartNew())return; el<HTMLDialogElement>('export-dialog').close();
  snapshot();project=asBook(createPublication('','markdown'));style=project.style;filename='無題';marginOffset=0;selection={kind:'book'};selected=1;selectedPages.clear();inspectorMode='body';inspector.clear();syncSource();views.sync(true);el('notice').hidden=true;reflow(true);showLeft('source');manuscript.focus();
});
function openCommonStyles(target = 'all'): void {
  inspectorMode = 'styles'; inspector.clear(); typography.open(target); openPane('right', true); views.sync(); if (mobile.matches) activePanel('settings');
}
el('inspect-styles').addEventListener('click', () => { if (selection.kind !== 'book') select(selection); else openCommonStyles(); });
el('typography-target').addEventListener('change', () => {
  const target = el<HTMLSelectElement>('typography-target').value;
  if (target === 'context') { if (selection.kind !== 'book') select(selection); }
  else { inspectorMode = 'styles'; inspector.clear(); views.sync(); }
});
const inspectorTabs = ['inspect-book', 'inspect-styles'].map(id => el<HTMLButtonElement>(id));
inspectorTabs.forEach((tab, at) => tab.addEventListener('keydown', event => {
  if (event.isComposing || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (at + 1) % 2;
  inspectorTabs[next]!.click(); inspectorTabs[next]!.focus();
}));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-canvas-action]')) button.addEventListener('click', () => views.elementAction(button.dataset.canvasAction as Parameters<typeof views.elementAction>[0]));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-canvas-add]')) button.addEventListener('click', () => { const p = result?.pages[selected - 1]; if (p?.kind !== 'layout') return; select({ kind: 'special', id: p.pageId }, false); inspectorMode = 'selection'; views.sync(true); el(`add-element-${button.dataset.canvasAdd}`).click(); });
el('edit-selection').addEventListener('click', () => { if (selection.kind !== 'book') select(selection); });
el('sample-manuscript').addEventListener('click', () => {
  if (source || project.assets.length) return;
  snapshot();
  const sample = createPublication(SAMPLE.source);
  project = asBook({ ...sample, document: { ...sample.document, title: SAMPLE.title, author: SAMPLE.author }, style });
  filename = SAMPLE.title; syncSource(); reflow(true); manuscript.focus();
});
el('expand-manuscript').addEventListener('click', () => {
  if (!editorWide) { normalWidth = workspace.style.getPropertyValue('--left-width') || `${el('left-source').parentElement!.getBoundingClientRect().width}px`; normalRightOpen = workspace.dataset.rightOpen !== 'false'; workspace.style.setProperty('--left-width', `${Math.min(860, Math.max(540, Math.round(workspace.clientWidth * .53)))}px`); openPane('right', false); }
  else { workspace.style.setProperty('--left-width', normalWidth); openPane('right', normalRightOpen); }
  editorWide = !editorWide; syncEditorWidthButton();
  el('resize-left').setAttribute('aria-valuenow', String(parseFloat(workspace.style.getPropertyValue('--left-width')))); saveWorkspace(); resizePaper();
});
for (const [id, key] of [['book-title', 'title'], ['book-author', 'author']] as const) input(id).addEventListener('change', () => commit({ ...currentProject(), document: { ...project.document, [key]: input(id).value || (key === 'title' ? '本文' : '') } }));
document.querySelectorAll<HTMLElement>('.mobile-tabs [role=tab]').forEach(b => b.addEventListener('click', () => activePanel(b.dataset.target!)));
document.querySelectorAll<HTMLElement>('[data-left-view]').forEach(b => b.addEventListener('click', () => showLeft(b.dataset.leftView!)));
document.querySelectorAll<HTMLElement>('[data-left-view]').forEach((button, index, tabs) => button.addEventListener('keydown', event => {
  const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
  if (!step && event.key !== 'Home' && event.key !== 'End') return; event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + step + tabs.length) % tabs.length;
  tabs[next]!.click(); tabs[next]!.focus();
}));
for (const side of ['left', 'right'] as const) {
  el(`toggle-${side}`).addEventListener('click', () => { openPane(side, true); el(`close-${side}`).focus(); }); el(`close-${side}`).addEventListener('click', () => { openPane(side, false); el(`toggle-${side}`).focus(); });
  const divider = el(`resize-${side}`), setWidth = (value: number) => { const n = Math.max(side === 'left' ? 300 : 260, Math.min(side === 'left' ? 900 : 480, value)); workspace.style.setProperty(`--${side}-width`, `${n}px`); divider.setAttribute('aria-valuenow', String(n)); resizePaper(); };
  divider.addEventListener('pointerdown', e => {
    const start = e.clientX, width = (side === 'left' ? el('left-source').parentElement! : el('book-settings').parentElement!).getBoundingClientRect().width; divider.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => setWidth(width + (event.clientX - start) * (side === 'left' ? 1 : -1)), end = () => { divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', end); divider.removeEventListener('pointercancel', end); saveWorkspace(); };
    divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', end);
  });
  divider.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(Number(divider.getAttribute('aria-valuenow')) + (e.key === 'ArrowRight' ? 10 : -10) * (side === 'left' ? 1 : -1)); saveWorkspace(); } });
}
for (const [id, mode] of [['view-single', 'single'], ['view-spread', 'spread'], ['view-gallery', 'gallery']] as const) el(id).addEventListener('click', () => { viewMode = mode; explicitSpread = mode === 'spread'; showPages(); scheduleSave(); });
el('preview-zoom').addEventListener('click', () => { zoomed = !zoomed; panel.dataset.zoom = String(zoomed); const button = el('preview-zoom'); button.setAttribute('aria-pressed', String(zoomed)); button.setAttribute('aria-label', zoomed ? '全体' : '拡大'); button.title = zoomed ? '全体を表示' : '拡大'; button.querySelector<HTMLElement>('[data-icon]')!.dataset.icon = zoomed ? 'zoom-out' : 'zoom-in'; resizePaper(); resetReadingPosition(); });
el('focus-preview').addEventListener('click', focusPaper);
workbenchShell({ showLeft, showPreview() { if (mobile.matches) activePanel('preview'); }, focusPaper,
  edit(command) { showLeft('source'); if(command==='range'||command==='center'){formatSelection();if(command==='center'&&!el('block-inspector').hidden){inspector.align('center');}}else document.querySelector<HTMLButtonElement>(`[data-insert="${command}"]`)!.click(); },
  showSettings(detail) {
  if (detail === 'shared-styles' || detail === 'typography') openCommonStyles(); else el('inspect-book').click();
  if (detail === 'typography') { el('typography-target').focus(); return; }
  if (detail) { const details = el<HTMLDetailsElement>(detail); details.open = true; details.querySelector<HTMLElement>('summary')!.focus(); details.scrollIntoView({ block: 'nearest' }); }
  else input('page-size').focus();
} });
function move(direction: -1 | 1): void { if (!result) return; selected = adjacentPage(selected, result.pages.length, direction, single()); showPages(); scheduleSave(); }
el('previous-page').addEventListener('click', () => move(-1)); el('next-page').addEventListener('click', () => move(1));
input('page-select').addEventListener('input', () => { const next = Number(input('page-select').value); if (!Number.isInteger(next) || next < 1) return; selected = next; showPages(); scheduleSave(); });
panel.addEventListener('keydown', e => { if (e.target instanceof HTMLInputElement || (e.target as Element).closest('.paper')) return; if ((single() && e.key === 'ArrowDown') || (!single() && e.key === (style.binding === 'left' ? 'ArrowRight' : 'ArrowLeft'))) { e.preventDefault(); move(1); } else if ((single() && e.key === 'ArrowUp') || (!single() && e.key === (style.binding === 'left' ? 'ArrowLeft' : 'ArrowRight'))) { e.preventDefault(); move(-1); } });
let touchStart: { x: number; y: number } | undefined;
preview.addEventListener('touchstart', e => { if (mobile.matches && !zoomed && viewMode !== 'gallery' && selection.kind !== 'special') touchStart = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; }, { passive: true });
preview.addEventListener('touchend', e => { if (!touchStart) return; const dy = e.changedTouches[0]!.clientY - touchStart.y, dx = e.changedTouches[0]!.clientX - touchStart.x; touchStart = undefined; if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx)) move(dy < 0 ? 1 : -1); }, { passive: true });
mobile.addEventListener('change', showPages); compact.addEventListener('change', showPages);
narrow.addEventListener('change',()=>{if(!narrow.matches&&hiddenPane){workspace.dataset[`${hiddenPane}Open`]='true';el(`toggle-${hiddenPane}`).setAttribute('aria-expanded','true');hiddenPane=undefined;}else if(narrow.matches&&workspace.dataset.rightOpen!=='false')openPane('right',true);saveWorkspace();showPages();});
new ResizeObserver(resizePaper).observe(preview);
try {
  if (matchMedia('(min-width:761px) and (max-width:1199px)').matches) openPane('right', false);
  const raw = localStorage.getItem('bookmaker-workspace-v1');
  if (raw) {
    const prefs = JSON.parse(raw) as Record<string, unknown>;
    if (prefs && typeof prefs === 'object') {
      if (['source', 'structure', 'assets'].includes(String(prefs.leftView))) showLeft(String(prefs.leftView));
      for (const side of ['left', 'right'] as const) {
        if (typeof prefs[`${side}Open`] === 'boolean') openPane(side, Boolean(prefs[`${side}Open`]));
        const w = prefs[`${side}Width`];
        if (typeof w === 'string' && /^\d{3}px$/u.test(w)) workspace.style.setProperty(`--${side}-width`, `${Math.min(side === 'left' ? 900 : 480, Math.max(side === 'left' ? 300 : 260, parseInt(w, 10)))}px`);
      }
      editorWide = prefs.editorWide === true;
      if (typeof prefs.normalWidth === 'string' && /^\d{3}px$/u.test(prefs.normalWidth)) normalWidth = `${Math.min(900, Math.max(300, parseInt(prefs.normalWidth, 10)))}px`;
      normalRightOpen = prefs.normalRightOpen !== false;
    }
  }
} catch { /* A damaged view preference must not prevent recovery of the book. */ }
for (const side of ['left', 'right'] as const) el(`resize-${side}`).setAttribute('aria-valuenow', String(parseFloat(getComputedStyle(workspace).getPropertyValue(`--${side}-width`))));
function syncEditorWidthButton(): void {
  const button = el('expand-manuscript'), label = editorWide ? '通常の幅に戻す' : '原稿を広げる'; button.setAttribute('aria-label', label); button.title = label; button.setAttribute('aria-pressed', String(editorWide)); button.querySelector<HTMLElement>('[data-icon]')!.dataset.icon = editorWide ? 'minimize-2' : 'maximize-2';
}
syncEditorWidthButton();
let unchangedRestore = false;
try {
  const draft = await restoreBookDraft(); if (draft) { applyDraft(draft); unchangedRestore = draft.project.schemaVersion === 3 && draft.project.syntax === 'markdown' && !draftRecoveryState().restored; }
  if (draftRecoveryState().conflict) { canSave = false; el('save-state').textContent = '保存を停止'; el('save-state').dataset.state = 'error'; notify(new DraftConflict().message); }
} catch (error) { canSave = false; el('save-state').textContent = '保存を停止'; el('save-state').dataset.state = 'error'; notify(error instanceof Error ? error.message : '端末内の保存データを読めません。'); }
restoring = false; manuscript.value = project.sourceDraft ?? project.source; syncHistory();
if (unchangedRestore && canSave) { el('save-state').textContent = '保存済み'; el('save-state').dataset.state = 'saved'; }
reflow(false, !unchangedRestore);
