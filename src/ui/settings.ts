import type { BookStyle, DecorationPosition, FolioRule, RunningHead } from '../domain/contracts.js';
import { decorationSide } from '../domain/decoration.js';
import { geometry, PAGE_SIZES, presetStyle, PRESETS, IMAGE_PRESETS, imageStyle, type Preset } from '../domain/style.js';
import { el, input, setValue } from './dom.js';
import { appearanceEditor } from './appearance.js';
import { FONT_CATALOG } from '../domain/fonts.js';

interface SettingsHost {
  getStyle(): BookStyle; update(style: BookStyle): boolean;
  getOffset(): number; setOffset(offset: number): void; singleView(): void; selected(): number;
}
export function settings(host: SettingsHost) {
  const imagePreset = el<HTMLSelectElement>('image-preset');
  for (const [key,value] of Object.entries(IMAGE_PRESETS)) imagePreset.append(new Option(value.label,key));
  imagePreset.addEventListener('change',()=>{if(!imagePreset.value)return;host.setOffset(0);host.singleView();changed(imageStyle(host.getStyle(),imagePreset.value as keyof typeof IMAGE_PRESETS));imagePreset.value='';});
  const changed = (next: BookStyle) => { if (host.update(next)) el('preset-caption').textContent = '原稿に合わせて調整しています。'; };
  const appearance=appearanceEditor({getStyle:()=>host.getStyle(),change:changed});
  const folioFont=el<HTMLSelectElement>('folio-font');for(const font of FONT_CATALOG)folioFont.append(new Option(font.label,font.family));
  folioFont.addEventListener('change',()=>{const s=host.getStyle();const folio={...s.folio!};if(folioFont.value)folio.fontFamily=folioFont.value;else delete folio.fontFamily;changed({...s,folio});});
  const number = (id: string) => Number(input(id).value);
  const numeric = (id: string, change: (style: BookStyle, value: number) => BookStyle) => input(id).addEventListener('change', () => changed(change(host.getStyle(), number(id))));
  for (const [id, key] of [['font-size', 'fontPt'], ['line-height', 'lineHeight']] as const) input(id).addEventListener('input', () => changed({ ...host.getStyle(), [key]: number(id) }));
  numeric('font-pt', (s, v) => ({ ...s, fontPt: v }));
  numeric('column-gap', (s,v)=>({...s,columnGapMm:v}));
  el('page-count-multiple').addEventListener('change', () => changed({ ...host.getStyle(), pageCountMultiple: Number(el<HTMLSelectElement>('page-count-multiple').value) as NonNullable<BookStyle['pageCountMultiple']> }));
  el('page-writing').addEventListener('change',()=>changed({...host.getStyle(),writingMode:el<HTMLSelectElement>('page-writing').value as BookStyle['writingMode']}));
  el('page-binding').addEventListener('change',()=>changed({...host.getStyle(),binding:el<HTMLSelectElement>('page-binding').value as BookStyle['binding']}));
  el('page-columns').addEventListener('change',()=>changed({...host.getStyle(),columns:Number(el<HTMLSelectElement>('page-columns').value) as 1|2}));
  numeric('line-mm', (s, v) => ({ ...s, lineHeight: v / (s.fontPt * 25.4 / 72) }));
  for (const [id, key] of [['margin-top', 'topMm'], ['margin-bottom', 'bottomMm'], ['margin-inner', 'innerMm'], ['margin-outer', 'outerMm']] as const) numeric(id, (s, v) => { host.setOffset(0); return { ...s, margins: { ...s.margins, [key]: v } }; });
  for (const [id, key] of [['grid-chars', 'maxCharsPerLine'], ['grid-lines', 'maxLinesPerPage']] as const) input(id).addEventListener('change', () => {
    const next = { ...host.getStyle() }; if (input(id).value === '') delete next[key]; else next[key] = number(id); changed(next);
  });
  input('margin').addEventListener('input', () => {
    const offset = number('margin'), delta = offset - host.getOffset(), s = host.getStyle();
    if (host.update({ ...s, margins: { topMm: s.margins.topMm + delta, bottomMm: s.margins.bottomMm + delta, innerMm: s.margins.innerMm + delta, outerMm: s.margins.outerMm + delta } })) host.setOffset(offset);
    sync();
  });
  input('auto-indent').addEventListener('change', () => changed({ ...host.getStyle(), paragraphIndent: input('auto-indent').checked }));

  el<HTMLSelectElement>('page-layout').addEventListener('change', event => {
    const s = host.getStyle(), uniform = (event.currentTarget as HTMLSelectElement).value === 'uniform';
    changed({ ...s, pageLayout: uniform ? 'uniform' : 'book' });
  });
  el<HTMLSelectElement>('page-size').addEventListener('change', event => {
    const key = (event.currentTarget as HTMLSelectElement).value;
    el('custom-size').hidden = key !== 'custom'; if (key === 'custom') return;
    const size = PAGE_SIZES[key as keyof typeof PAGE_SIZES]; changed({ ...host.getStyle(), page: { widthMm: size.widthMm, heightMm: size.heightMm } });
  });
  for (const id of ['page-width', 'page-height']) numeric(id, s => ({ ...s, page: { widthMm: number('page-width'), heightMm: number('page-height') } }));
  document.querySelectorAll<HTMLElement>('[data-preset]').forEach(button => button.addEventListener('click', () => {
    const p = button.dataset.preset as Preset, base = presetStyle(p), s = host.getStyle(), uniform = s.pageLayout === 'uniform';
    host.setOffset(0);
    const next = { ...s, fontPt: base.fontPt, lineHeight: base.lineHeight, margins: uniform ? { ...base.margins, innerMm: (base.margins.innerMm + base.margins.outerMm) / 2, outerMm: (base.margins.innerMm + base.margins.outerMm) / 2 } : base.margins };
    delete next.maxCharsPerLine; delete next.maxLinesPerPage; changed(next);
    el('preset-caption').textContent = { standard: '読みやすさと、自然な本文の密度。', compact: '少し小さな文字で、文章をすっきり。', relaxed: 'ゆとりのある文字と行間で、穏やかに。' }[p];
  }));
  for (const id of ['folio-enabled', 'folio-from', 'folio-start', 'folio-position', 'folio-size', 'folio-inset']) el(id).addEventListener('change', () => {
    const s = host.getStyle(); changed({ ...s, folio: { ...s.folio!, enabled: input('folio-enabled').checked, fromPage: number('folio-from'), startNumber: number('folio-start'), position: el<HTMLSelectElement>('folio-position').value as DecorationPosition, fontPt: number('folio-size'), insetMm: number('folio-inset') } });
  });
  el('add-folio-rule').addEventListener('click', () => { const s = host.getStyle(); changed({ ...s, folio: { ...s.folio!, rules: [...s.folio!.rules, { id: crypto.randomUUID(), from: host.selected(), to: host.selected(), enabled: false }] } }); });
  el('add-head-rule').addEventListener('click', () => { const s = host.getStyle(); changed({ ...s, runningHeads: [...s.runningHeads!, { id: crypto.randomUUID(), from: host.selected(), to: null, side: 'both', position: 'top-outer', text: '', fontPt: 7, insetMm: 8 }] }); });

  function positionSelect(control: HTMLSelectElement, position: DecorationPosition): void {
    const uniform = host.getStyle().pageLayout === 'uniform';
    for (const option of Array.from(control.options)) {
      const side = option.value.split('-')[1];
      option.hidden = uniform && (side === 'outer' || side === 'inner'); option.disabled = option.hidden;
    }
    const value = uniform ? `${position.split('-')[0]}-${decorationSide('uniform', 1, position)}` : position;
    if (control.value !== value) control.value = value;
  }

  function ruleForms(kind: 'folio' | 'head', rules: readonly (FolioRule | RunningHead)[]): void {
    const container = el(kind === 'folio' ? 'folio-rules' : 'head-rules');
    if (Array.from(container.children).map(c => (c as HTMLElement).dataset.ruleId).join(',') !== rules.map(r => r.id).join(',')) {
      container.replaceChildren();
      for (const rule of rules) {
        const form = document.createElement('div'); form.className = 'rule-fields'; form.dataset.ruleId = rule.id;
        form.innerHTML = `<div class="field-pair"><label>開始ページ<input data-field="from" aria-label="範囲の開始ページ" type="number" min="1" max="100000"></label><label>終了ページ<input data-field="to" aria-label="範囲の終了ページ" type="number" min="1" max="100000" placeholder="最後まで"></label></div>${kind === 'head' ? '<label class="select-label">上部の文字<input data-field="text" aria-label="柱の文字" type="text" maxlength="100" placeholder="作品名・章名など"></label><div class="field-pair"><label>対象<select data-field="side" aria-label="柱の対象"><option value="both">全ページ</option><option value="odd">奇数ページ</option><option value="even">偶数ページ</option></select></label><label>位置<select data-field="position" aria-label="柱の位置"><option value="top-outer">上・小口</option><option value="top-inner">上・ノド</option><option value="top-left">上・左</option><option value="top-center">上・中央</option><option value="top-right">上・右</option></select></label></div><div class="field-pair"><label>大きさ / pt<input data-field="fontPt" aria-label="柱の大きさ" type="number" min="5" max="12" step="0.5"></label><label>端から / mm<input data-field="insetMm" aria-label="柱の端からの距離" type="number" min="3" max="20" step="0.5"></label></div>' : '<label class="check-label"><input data-field="enabled" aria-label="範囲内の番号を表示" type="checkbox">範囲内の番号を表示</label><label class="select-label">開始番号（空欄で続き）<input data-field="startNumber" aria-label="範囲の開始番号" type="number" min="0" max="100000" placeholder="続きの番号"></label>'}<button type="button" class="rule-remove">この指定を削除</button>`;
        if(kind==='head'){const row=document.createElement('label');row.className='select-label';row.textContent='書体';const control=document.createElement('select');control.dataset.field='fontFamily';control.setAttribute('aria-label','柱の書体');control.append(new Option('本の書体に従う',''));for(const font of FONT_CATALOG)control.append(new Option(font.label,font.family));row.append(control);form.insertBefore(row,form.querySelector('.rule-remove'));}
        const edit = (control: HTMLInputElement | HTMLSelectElement) => {
          const s = structuredClone(host.getStyle()), items = kind === 'head' ? [...s.runningHeads!] : [...s.folio!.rules], item = items.find(r => r.id === rule.id)!;
          const key = control.dataset.field!, value = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : key === 'fontFamily' ? control.value || undefined : ['text', 'side', 'position'].includes(key) ? control.value : control.value === '' && key === 'to' ? null : Number(control.value);
          if (key === 'startNumber' && control.value === '') delete (item as FolioRule).startNumber; else Object.assign(item, { [key]: value });
          if (item.to !== null && item.from > item.to) { if (key === 'from') item.to = item.from; else item.from = item.to; }
          changed(kind === 'head' ? { ...s, runningHeads: items as RunningHead[] } : { ...s, folio: { ...s.folio!, rules: items as FolioRule[] } });
        };
        form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(c => c.addEventListener(c.dataset.field === 'text' ? 'input' : 'change', () => edit(c)));
        form.querySelector('button')!.addEventListener('click', () => { const s = host.getStyle(); changed(kind === 'head' ? { ...s, runningHeads: s.runningHeads!.filter(r => r.id !== rule.id) } : { ...s, folio: { ...s.folio!, rules: s.folio!.rules.filter(r => r.id !== rule.id) } }); });
        container.append(form);
      }
    }
    for (const [i, rule] of rules.entries()) {
      const form = container.children[i]!;
      for (const c of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]'))) {
        const value = (rule as unknown as Record<string, unknown>)[c.dataset.field!];
        if (c instanceof HTMLSelectElement && c.dataset.field === 'position') positionSelect(c, value as DecorationPosition);
        else if (c instanceof HTMLInputElement && c.type === 'checkbox') c.checked = Boolean(value); else { const text = value === undefined || value === null ? '' : String(value); if (c.value !== text) c.value = text; }
      }
    }
  }
  function sync(): void {
    const s = host.getStyle(), grid = geometry(s), uniform = s.pageLayout === 'uniform';
    setValue('page-count-multiple', s.pageCountMultiple ?? 1);
    setValue('page-binding',s.binding);setValue('page-writing',s.writingMode);setValue('page-columns',s.columns);setValue('column-gap',s.columnGapMm??6);
    setValue('font-size', s.fontPt); el('font-size-value').textContent = `${s.fontPt} pt`;
    setValue('line-height', s.lineHeight); el('line-height-value').textContent = s.lineHeight.toFixed(2);
    const marginsMatch = (base: typeof PRESETS[Preset]) => Object.entries(base.margins).every(([key, value]) => s.margins[key as keyof typeof s.margins] === (uniform && (key === 'innerMm' || key === 'outerMm') ? (base.margins.innerMm + base.margins.outerMm) / 2 : value));
    setValue('margin', host.getOffset()); el('margin-value').textContent = host.getOffset() ? `${host.getOffset() > 0 ? '+' : ''}${host.getOffset()} mm` : Object.values(PRESETS).some(marginsMatch) ? '標準' : '個別の値';
    setValue('page-layout', s.pageLayout ?? 'book'); el('page-layout-caption').textContent = uniform ? '余白を固定し、左右を合わせる白ページは入れません。' : 'ノドと小口を入れ替え、章や改丁の開始面をそろえます。';
    el('image-preset-row').hidden = !uniform;
    const key = Object.entries(PAGE_SIZES).find(([, p]) => p.widthMm === s.page.widthMm && p.heightMm === s.page.heightMm)?.[0] ?? 'custom';
    if (!el('custom-size').hidden && el<HTMLSelectElement>('page-size').value === 'custom') { /* Keep custom editing open even at a preset dimension. */ } else { setValue('page-size', key); el('custom-size').hidden = key !== 'custom'; }
    setValue('page-width', s.page.widthMm); setValue('page-height', s.page.heightMm); setValue('font-pt', s.fontPt); setValue('line-mm', Number(grid.lineMm.toFixed(3)));
    for (const [id, value] of [['margin-top', s.margins.topMm], ['margin-bottom', s.margins.bottomMm], ['margin-inner', s.margins.innerMm], ['margin-outer', s.margins.outerMm], ['grid-chars', s.maxCharsPerLine ?? ''], ['grid-lines', s.maxLinesPerPage ?? '']] as const) setValue(id, value);
    el('inner-label').textContent = uniform ? '右 / mm' : 'ノド / mm'; el('outer-label').textContent = uniform ? '左 / mm' : '小口 / mm';
    input('auto-indent').checked = !!s.paragraphIndent; appearance.sync(); setValue('folio-font',s.folio?.fontFamily??'');
    el('grid-size').textContent = `${grid.chars}字 × ${grid.lines}行${s.columns===2?' × 2段':''}`; el('layout-info').textContent = el('grid-size').textContent;
    const format = key === 'custom' ? '自由寸法' : PAGE_SIZES[key as keyof typeof PAGE_SIZES].label;
    el('format-label').textContent = uniform ? `${Math.round(s.page.widthMm/25.4*300)} × ${Math.round(s.page.heightMm/25.4*300)} px` : format; const dimensions = document.createElement('span'); dimensions.textContent = `${s.page.widthMm} × ${s.page.heightMm} mm`; el('format-label').append(dimensions); el('edition').textContent = `${format} · ${s.writingMode==='vertical-rl'?'縦書き':'横書き'}`;
    document.querySelectorAll<HTMLElement>('[data-preset]').forEach(b => { const base = PRESETS[b.dataset.preset as Preset]; b.setAttribute('aria-pressed', String(s.fontPt === base.fontPt && s.lineHeight === base.lineHeight && marginsMatch(base) && !s.maxCharsPerLine && !s.maxLinesPerPage && host.getOffset() === 0)); });
    const f = s.folio!; input('folio-enabled').checked = f.enabled;
    for (const [id, value] of [['folio-from', f.fromPage], ['folio-start', f.startNumber], ['folio-size', f.fontPt], ['folio-inset', f.insetMm]] as const) setValue(id, value);
    positionSelect(el<HTMLSelectElement>('folio-position'), f.position);
    el('folio-explanation').textContent = `${f.fromPage}ページ目に「${f.startNumber}」を表示し、それ以前には番号を出しません。表示するページの選択とは独立しています。`;
    ruleForms('folio', f.rules); ruleForms('head', s.runningHeads ?? []);
  }
  return { sync };
}
