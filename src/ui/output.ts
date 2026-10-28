import type { BookStyle, BookPage, ViewMode, Diagnostic } from '../domain/contracts.js';
import type { Publication, PrintSettings } from '../domain/model.js';
import { serializeProject } from '../domain/project.js';
import { printSettings, screenPDF, monoPDF, colorPDF, printGeometry, printRasterSize, printIssues, validatePrintSettings } from '../domain/print.js';
import { renderPrintProof } from '../render/print.js';
import { bookNavigation } from '../domain/navigation.js';
import { spreadPages } from '../domain/page-order.js';
import { rasterize, rasterizeSpread, pngBlob } from '../io/raster.js';
import { exportPDF } from '../io/pdf.js';
import { downloadBlob } from '../io/text.js';
import { zipBlobs } from '../io/zip.js';
import { productionBundle } from '../io/bundle.js';
import { imageExportPlan } from '../domain/image-export.js';
import { el, input, setValue } from './dom.js';

interface OutputState { revision: number; diagnostics: readonly Diagnostic[]; source: string; project: Publication; filename: string; style: BookStyle; pages: readonly BookPage[]; selected: number; viewMode: ViewMode }
interface OutputHost { state(): OutputState; ready(): boolean; rename(name: string): void; printSettings(settings: PrintSettings): void; active(open: boolean): void; revealIssue(blockId?: string, elementId?: string, pageNumber?: number): void }
type Format = 'png' | 'pdf' | 'zip' | 'spread' | 'project' | 'source' | 'bundle';
export function output(host: OutputHost) {
  const dialog = el<HTMLDialogElement>('export-dialog'); let controller: AbortController | undefined, savedURL: string | undefined, savedKey = '', newProjectReady = false, checkRevision = -1, preflightKey = '', proofKey = '';
  const key = (s: OutputState) => `${s.revision}:${s.filename}:${s.selected}:${el<HTMLSelectElement>('export-scope').value}:${input('export-from').value}:${input('export-to').value}:${el<HTMLSelectElement>('export-batch-size').value}:${JSON.stringify(printSettings(s.project))}`;
  const lossCodes = new Set(['element-overflow', 'text-box-overflow', 'asset-missing']);
  function clearResult(): void {
    if (savedURL) URL.revokeObjectURL(savedURL); savedURL = undefined; savedKey = ''; newProjectReady = false; el('export-result').hidden = true; el('new-project-confirmation').hidden = true;
    el('save-output').removeAttribute('href'); el('open-output').removeAttribute('href');
  }
  const canStartNew = () => newProjectReady && !!savedURL && savedKey === key(host.state()) && !controller;
  const commitName = () => host.rename(input('export-name').value.trim() || '原稿');
  const range = (state: OutputState) => {
    const ranged = el<HTMLSelectElement>('export-scope').value === 'range', from = ranged ? Number(input('export-from').value) : 1, to = ranged ? Number(input('export-to').value) : state.pages.length;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > state.pages.length) throw new Error(`ページ範囲は1〜${state.pages.length}ページの中で指定してください。`);
    return state.pages.slice(from - 1, to);
  };
  function sync(): void {
    const s = host.state(); if (savedURL && savedKey !== key(s)) clearResult();
    if (checkRevision !== s.revision) { checkRevision = s.revision; input('export-accept-loss').checked = false; }
    const settings = printSettings(s.project);
    let outputPages: readonly BookPage[] = s.pages; try { outputPages = range(s); } catch { outputPages = []; }
    const printWarnings = printIssues(outputPages, s.style, settings, s.project).map(v => ({ ...v, code: 'print-warning' }));
    const issues = [...s.diagnostics, ...printWarnings].filter((d, i, all) => all.findIndex(v => v.code === d.code && v.blockId === d.blockId && v.elementId === d.elementId && v.pageNumber === d.pageNumber) === i), hasLoss = issues.some(d => lossCodes.has(d.code)), draft = s.project.sourceDraft !== undefined;
    const enabled = host.ready() && !controller && (!hasLoss || input('export-accept-loss').checked);
    const currentPreflight = JSON.stringify([draft, host.ready(), issues]);
    if (preflightKey !== currentPreflight) {
      preflightKey = currentPreflight; const list = el('export-issues'); list.replaceChildren();
      const add = (message: string, blockId?: string, elementId?: string, pageNumber?: number) => { const row = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = `${pageNumber?`p.${pageNumber} · `:''}${message}`; button.addEventListener('click', () => { dialog.close(); host.revealIssue(blockId,elementId,pageNumber); }); row.append(button); list.append(row); };
      if (draft) add('原稿の指定が未完です。原稿を確認');
      else if (!host.ready()) add(s.source ? '組版の完了を待っています' : '原稿またはページを追加');
      for (const issue of issues) add(issue.message, issue.blockId,issue.elementId,issue.pageNumber);
    }
    el('export-preflight').hidden = dialog.dataset.intent === 'new-project' || !issues.length && !draft && host.ready();
    el('export-loss-choice').hidden = !hasLoss || draft || !host.ready(); input('export-accept-loss').disabled = !host.ready();
    for (const id of ['export-png', 'export-pdf', 'export-png-all', 'export-spread']) el<HTMLButtonElement>(id).disabled = !enabled;
    for (const id of ['export-project', 'export-source', 'export-bundle']) el<HTMLButtonElement>(id).disabled = !!controller;
    el<HTMLButtonElement>('start-new-project').disabled = !canStartNew(); el<HTMLButtonElement>('new-project-save').disabled = !!controller;
    const size = s.pages[s.selected-1]?.style?.page ?? s.style.page, pixels = [size.widthMm, size.heightMm].map(mm => Math.round(mm / 25.4 * 300));
    el('png-label').textContent = `${s.selected}ページを一枚の画像に`; el('export-info').textContent = `${s.pages.length}ページ · PNG ${pixels.join(' × ')} px`;
    el('spread-label').textContent = `${s.selected}ページを含む見開き`;
    el('pdf-label').textContent = (el<HTMLSelectElement>('export-scope').value === 'all' ? 'すべてのページ' : '指定した範囲') + ` · ${settings.dpi} dpi`;
    el('png-all-label').textContent = el<HTMLSelectElement>('export-scope').value === 'all' ? '全ページをまとめて保存（ZIP）' : '指定範囲をまとめて保存（ZIP）';
    const preset = settings.purpose === 'screen' ? 'screen' : JSON.stringify(settings) === JSON.stringify(monoPDF) ? 'mono' : JSON.stringify(settings) === JSON.stringify(colorPDF) ? 'color' : 'custom';
    setValue('export-pdf-preset', preset); if (document.activeElement !== input('export-bleed')) setValue('export-bleed', settings.bleedMm); setValue('export-marks', settings.marks); setValue('export-dpi', settings.dpi); setValue('export-color', settings.color); setValue('export-pdf-mode', settings.pdfSource);
    const sheet = printGeometry(s.style, settings), mm = (v: number) => Number(v.toFixed(2));
    el('export-sheet-info').textContent = `仕上がり ${mm(sheet.trim.width)} × ${mm(sheet.trim.height)} mm · PDF用紙 ${mm(sheet.media.width)} × ${mm(sheet.media.height)} mm`;
    const proof = el('export-print-proof'), showProof = dialog.open && dialog.dataset.intent === 'export' && el<HTMLDetailsElement>('export-pdf-details').open && settings.purpose === 'print' && !!s.pages.length;
    el('export-print-note').hidden = settings.purpose !== 'print'; proof.hidden = !showProof; proof.setAttribute('aria-busy', String(showProof && !host.ready()));
    const nextProof = JSON.stringify([s.revision, s.selected, settings]);
    if (showProof && host.ready() && proofKey !== nextProof) { proofKey = nextProof; proof.innerHTML = renderPrintProof(s.pages[s.selected - 1] ?? s.pages[0]!, s.style, settings); }
    else if (!showProof) { proofKey = ''; proof.replaceChildren(); }
    el('export-range').hidden = el<HTMLSelectElement>('export-scope').value !== 'range';
    input('export-from').max = String(s.pages.length); input('export-to').max = String(s.pages.length);
    setValue('export-name', s.filename);
  }
  function open(intent: 'export' | 'new-project' = 'export'): void {
    if (intent === 'export' && newProjectReady) clearResult();
    dialog.dataset.intent = intent; el('output-heading').textContent = intent === 'new-project' ? '作業を保存' : '書き出す';
    for (const id of ['export-info', 'image-export-options', 'export-file-options']) el(id).hidden = intent === 'new-project';
    el('new-project-save').hidden = intent !== 'new-project';
    if (dialog.open) { sync(); return; }
    const s = host.state();
    if (!input('export-from').value || el<HTMLSelectElement>('export-scope').value === 'all') { input('export-from').value = '1'; input('export-to').value = String(s.pages.length); }
    else { input('export-from').value = String(Math.max(1, Math.min(s.pages.length, Number(input('export-from').value)))); input('export-to').value = String(Math.max(Number(input('export-from').value), Math.min(s.pages.length, Number(input('export-to').value)))); }
    sync(); dialog.showModal(); host.active(true); sync();
  }
  async function write(format: Format, forNewProject = false): Promise<boolean> {
    const imageOutput = !['project', 'source', 'bundle'].includes(format);
    if (controller || imageOutput && (!host.ready() || host.state().diagnostics.some(d => lossCodes.has(d.code)) && !input('export-accept-loss').checked)) return false;
    commitName();
    const s = structuredClone(host.state()), safeName = s.filename.replace(/[\\/:*?"<>|\u0000-\u001F]/gu, '_').slice(0, 100) || '原稿';
    controller = new AbortController(); const current = controller;
    el('export-progress').hidden = false; el('export-progress-text').textContent = 'ページを準備しています…'; el('output-error').hidden = true;
    clearResult(); sync(); const startedKey = key(s);
    try {
      let blob: Blob, name: string;
      if (format === 'project') {
        blob = new Blob([serializeProject({ ...s.project, metadata: { filename: s.filename, viewMode: s.viewMode, selected: s.selected } })], { type: 'application/json' }); name = `${safeName}.book.json`;
      } else if (format === 'source') { blob = new Blob([s.source], { type: 'text/plain;charset=utf-8' }); name = `${safeName}.${s.project.syntax === 'markdown' ? 'md' : 'txt'}`; }
      else if (format === 'bundle') { blob = await productionBundle({ ...s.project, metadata: { filename: s.filename, viewMode: s.viewMode, selected: s.selected } }, current.signal); name = `${safeName}.compholio.zip`; }
      else if (format === 'png' || format === 'spread') {
        const spread = spreadPages(s.selected, s.pages.length, s.style.binding), canvas = format === 'png' ? await rasterize(s.pages[s.selected - 1]!, s.style) : await rasterizeSpread(spread.left ? s.pages[spread.left - 1] : undefined, spread.right ? s.pages[spread.right - 1] : undefined, s.style);
        try { current.signal.throwIfAborted(); blob = await pngBlob(canvas); } finally { canvas.width = 0; canvas.height = 0; }
        name = `${safeName}-${format === 'spread' ? '見開き-' : ''}${String(s.selected).padStart(3, '0')}.png`;
      } else {
        const pages = range(s), span = pages.length === s.pages.length ? '' : `-${pages[0]!.number}-${pages.at(-1)!.number}`;
        if (format === 'pdf') { blob = await exportPDF(pages, s.style, s.filename, current.signal, count => { el('export-progress-text').textContent = `${count} / ${pages.length} ページを準備しました`; }, bookNavigation(s.project, s.pages, pages), s.project, printSettings(s.project)); name = `${safeName}${span}.pdf`; }
        else {
          const files: Record<string, Uint8Array> = {}, plan = imageExportPlan(pages, Number(el<HTMLSelectElement>('export-batch-size').value)); let total = 0;
          for (const [i, page] of pages.entries()) {
            current.signal.throwIfAborted(); const canvas = await rasterize(page, s.style);
            try { const data = new Uint8Array(await (await pngBlob(canvas)).arrayBuffer()); total += data.byteLength; if (total > 128 * 1024 * 1024) throw new Error('画像が128MBを超えました。範囲を分けて書き出してください。'); files[`${plan[i]!.folder}${safeName}-${String(page.number).padStart(5, '0')}.png`] = data; }
            finally { canvas.width = 0; canvas.height = 0; }
            el('export-progress-text').textContent = `${i + 1} / ${pages.length} ページを準備しました`; await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
          current.signal.throwIfAborted(); blob = await zipBlobs(files); name = `${safeName}${span}-PNG.zip`;
        }
      }
      current.signal.throwIfAborted(); if (key(host.state()) !== startedKey) throw new Error('作業が更新されました。最新の内容で書き出してください。');
      savedURL = URL.createObjectURL(blob); savedKey = startedKey;
      const save = el<HTMLAnchorElement>('save-output'), show = el<HTMLAnchorElement>('open-output'); save.href = savedURL; save.download = name; show.href = savedURL; show.hidden = format === 'zip' || format === 'bundle';
      el('export-result-text').textContent = name; el('export-result').hidden = false;
      newProjectReady = forNewProject && format === 'project'; el('new-project-confirmation').hidden = !newProjectReady;
      downloadBlob(blob, name); if (newProjectReady) save.focus(); return true;
    } catch (error) { el('output-error').textContent = current.signal.aborted ? '書き出しを中止しました。' : error instanceof Error ? error.message : '書き出しに失敗しました。'; el('output-error').hidden = false; return false; }
    finally { controller = undefined; el('export-progress').hidden = true; sync(); }
  }
  el('open-export').addEventListener('click', () => open());
  el('close-export').addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => { controller?.abort(); el('export-print-proof').replaceChildren(); proofKey = ''; host.active(false); });
  el('export-pdf-details').addEventListener('toggle', () => { if (dialog.open) sync(); });
  el('export-cancel').addEventListener('click', () => controller?.abort());
  el('new-project-save').addEventListener('click', () => { void write('project', true); });
  el('export-scope').addEventListener('change', sync);
  el('export-batch-size').addEventListener('change', sync);
  function updatePrint(next: PrintSettings): void {
    clearResult();
    try { const valid = validatePrintSettings(next); printRasterSize(host.state().style, valid); host.printSettings(valid); el('output-error').hidden = true; }
    catch (error) { el('output-error').textContent = error instanceof Error ? error.message : 'PDFの設定を確認してください。'; el('output-error').hidden = false; }
    sync();
  }
  el('export-pdf-preset').addEventListener('change', () => {
    const value = el<HTMLSelectElement>('export-pdf-preset').value;
    updatePrint({ ...(value === 'screen' ? screenPDF : value === 'mono' ? monoPDF : value === 'color' ? colorPDF : { ...printSettings(host.state().project), purpose: 'print' as const }) });
  });
  for (const id of ['export-bleed', 'export-marks', 'export-dpi', 'export-color', 'export-pdf-mode']) el(id).addEventListener('change', () => {
    updatePrint({ ...printSettings(host.state().project), purpose: id === 'export-pdf-mode' ? printSettings(host.state().project).purpose : 'print', bleedMm: Number(input('export-bleed').value), marks: el<HTMLSelectElement>('export-marks').value as PrintSettings['marks'], dpi: Number(el<HTMLSelectElement>('export-dpi').value) as PrintSettings['dpi'], color: el<HTMLSelectElement>('export-color').value as PrintSettings['color'], pdfSource: el<HTMLSelectElement>('export-pdf-mode').value as PrintSettings['pdfSource'] });
  });
  input('export-bleed').addEventListener('blur', sync);
  for (const id of ['export-from', 'export-to', 'export-accept-loss']) input(id).addEventListener('change', sync);
  input('export-name').addEventListener('input', () => { host.rename(input('export-name').value); sync(); });
  input('export-name').addEventListener('change', () => { commitName(); sync(); });
  for (const [id, format] of [['export-png', 'png'], ['export-pdf', 'pdf'], ['export-png-all', 'zip'], ['export-spread', 'spread'], ['export-project', 'project'], ['export-source', 'source'], ['export-bundle', 'bundle']] as const) el(id).addEventListener('click', () => { void write(format); });
  return { sync, open, canStartNew, saveProject(forNewProject = false) { open(forNewProject ? 'new-project' : 'export'); return write('project', forNewProject); } };
}
