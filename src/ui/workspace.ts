import { FONT_CATALOG } from '../domain/fonts.js';
import { PAPER_COLORS } from '../domain/colors.js';
import type { BookModel, BookAsset, SpecialPageDefinition, SpecialRole, PageElement, RunningElement, Scope, PageProperties } from '../domain/model.js';
import type { RenderedPages, DecorationPosition } from '../domain/contracts.js';
import { flattenDocument } from '../domain/publication.js';
import { addChapter, addSpecialPage, updateSpecialPage, removeBookItem, moveBookItem, duplicateBookItem, convertToFree, newElement, renameChapter, movePageElement, alignPageElement } from '../domain/book.js';
import { iconChoices, alignmentOptions, weightOptions, iconElement } from './choices.js';
import { styleFields } from './style-fields.js';
import { el, input } from './dom.js';
import { importAsset } from '../io/assets.js';
import { reorderBookItem, createLayoutPage, editPageElement, editPageElements, movePageElements, resizePageElement } from '../domain/editing.js';
import { assetReferences, insertAssetPages, removeUnusedAsset, replaceBookAsset } from '../domain/media.js';

export type Selection = { kind: 'book' } | { kind: 'block' | 'chapter' | 'running'; id: string } | { kind: 'range'; ids: string[] } | { kind: 'special'; id: string; elementId?: string; elementIds?: string[] } | { kind: 'pages'; numbers: number[] };
export const selectedElementIds = (s: Selection): string[] => s.kind==='special' ? s.elementIds??(s.elementId?[s.elementId]:[]) : [];
interface Host {
  book(): BookModel; result(): RenderedPages | undefined; selection(): Selection; inspectorMode(): 'body' | 'styles' | 'selection';
  textTarget(): {scope:string;label:string;count:number};
  select(value: Selection, reveal?: boolean): void; change(book: BookModel, message?: string): void;
  notify(message: string): void; revealSource(id: string): void; choosePage(n: number): void;
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; };
export function workspaceViews(host: Host) {
  const context = el('context-inspector'); let contextKey = '', abort: AbortController | undefined, replaceAssetId: string | undefined, insertingAssetId: string | undefined, assetAnchor: string | undefined;
  const folded = new Set<string>(), expandedLayers = new Set<string>();
  let assetListKey = '', assetThumbnails: string[] = [];
  function change(fn: (book: BookModel) => BookModel, message?: string): void {
    try { const book = host.book(); if (book.sourceDraft !== undefined) throw new Error('原稿の参照指定を完成・確定させてから操作してください。入力内容は保存されています。'); const next = fn(book); if (next !== book) host.change(next, message); }
    catch (error) { host.notify(error instanceof Error ? error.message : '設定を確認してください。'); sync(true); }
  }
  const group = (title?: string, parent = context) => { const g = node('div'); g.className = 'context-group'; if (title) g.append(node('h3', title)); parent.append(g); return g; };
  const caption = (text: string, parent: HTMLElement) => { const p = node('p', text); p.className = 'setting-caption'; parent.append(p); return p; };
  function field(parent: HTMLElement, label: string, id: string, value: string | number, callback: (value: string) => void, options?: readonly (readonly [string, string])[], multiline = false): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
    const l = node('label'); l.className = 'select-label'; l.htmlFor = id; l.append(node('span', label));
    const control = options ? node('select') : multiline ? node('textarea') : node('input');
    control.id = id; control.setAttribute('data-testid', id);
    if (control instanceof HTMLInputElement) { control.type = typeof value === 'number' ? 'number' : 'text'; if (control.type === 'text') control.maxLength = 4000; else control.step = '0.1'; }
    if (control instanceof HTMLSelectElement) for (const [v, name] of options ?? []) control.append(new Option(name, v));
    control.value = String(value); control.addEventListener(control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement && control.type === 'text' ? 'input' : 'change', () => callback(control.value)); l.append(control); parent.append(l); return control;
  }
  function button(parent: HTMLElement, label: string, callback: () => void, id?: string): HTMLButtonElement {
    const b = node('button', label); b.type = 'button';
    const alignIcons: Record<string, string> = { '左端': 'align-horizontal-justify-start', '左右中央': 'align-horizontal-justify-center', '右端': 'align-horizontal-justify-end', '上端': 'align-vertical-justify-start', '上下中央': 'align-vertical-justify-center', '下端': 'align-vertical-justify-end' };
    if (alignIcons[label]) { b.replaceChildren(iconElement(alignIcons[label]!)); b.className = 'icon-button'; b.setAttribute('aria-label', label); b.title = label; } if (id) b.id = id; b.addEventListener('click', callback); parent.append(b); return b;
  }
  const details = (label: string, parent: HTMLElement) => { const d = node('details'); d.className = 'style-details'; d.append(node('summary', label)); parent.append(d); return d; };
  const actions = (parent: HTMLElement) => { const a = node('div'); a.className = 'context-actions'; parent.append(a); return a; };
  const special = (id: string): SpecialPageDefinition => host.book().specialPages.find(p => p.id === id)!;
  const update = (id: string, patch: object) => change(b => { const current={...b.specialPages.find(p=>p.id===id)!} as unknown as Record<string,unknown>; for(const [key,value] of Object.entries(patch))if(value===undefined)delete current[key];else current[key]=value;return updateSpecialPage(b,id,current as unknown as SpecialPageDefinition); });
  const range = (ids: Set<string>) => {
    const numbers = host.result()?.pages.filter(p => p.kind === 'flow' ? p.lines.some(l => ids.has(l.blockId)) || p.elements?.some(e=>e.blockId&&ids.has(e.blockId)) : ids.has(p.blockId)).map(p => p.number) ?? [];
    return numbers.length ? `現在 p.${numbers[0]}–${numbers.at(-1)}` : '組版結果を待っています';
  };
  function outline(): void {
    const list = el('book-outline'), sel = host.selection(), focused = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.itemId : undefined; list.replaceChildren();
    const item = (label: string, scope: string, selection: Selection, kind: string, ids: Set<string>, parent = list) => {
      const b = node('button'); b.type = 'button'; b.className = 'outline-row'; b.dataset.kind = kind; b.dataset.itemId = scope;
      b.setAttribute('aria-current', String('id' in sel && sel.id === scope)); const name = node('span', label); name.className = 'outline-label'; b.append(name, node('small', range(ids)));
      if (kind !== 'book') {
        b.draggable = host.book().sourceDraft === undefined; b.title = 'ドラッグで移動 · Alt + ↑ / ↓';
        const grip = iconElement('grip-vertical'); grip.classList.add('outline-grip'); grip.setAttribute('aria-hidden', 'true'); b.prepend(grip);
        b.addEventListener('dragstart', event => { if (!event.dataTransfer) return; event.dataTransfer.setData('application/x-book-item', scope); event.dataTransfer.effectAllowed = 'move'; b.dataset.dragging = 'true'; });
        b.addEventListener('dragend', () => { delete b.dataset.dragging; list.querySelectorAll<HTMLElement>('[data-drop]').forEach(e => delete e.dataset.drop); });
        b.addEventListener('dragover', event => { if (!event.dataTransfer?.types.includes('application/x-book-item')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; b.dataset.drop = event.clientY < b.getBoundingClientRect().top + b.clientHeight / 2 ? 'before' : 'after'; });
        b.addEventListener('dragleave', () => { delete b.dataset.drop; });
        b.addEventListener('drop', event => { const id = event.dataTransfer?.getData('application/x-book-item'); if (!id) return; event.preventDefault(); event.stopPropagation(); const position = b.dataset.drop === 'after' ? 'after' : 'before'; delete b.dataset.drop; change(book => reorderBookItem(book, id, scope, position), '構成を移動しました。'); });
        b.addEventListener('keydown', event => {
          if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const trigger = b.parentElement?.querySelector<HTMLButtonElement>('[data-menu-item-id]'); if (trigger) openItemMenu(selection, scope, trigger); return; }
          if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); host.select(selection, false); change(book => moveBookItem(book, scope, event.key === 'ArrowUp' ? -1 : 1)); return; }
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const rows = [...list.querySelectorAll<HTMLButtonElement>('.outline-row')].filter(r=>r.offsetParent!==null), at = rows.indexOf(b), target = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowUp' ? -1 : 1))); rows[target]?.focus(); }
        });
      }
      b.addEventListener('click', () => { host.select(selection); const page = host.result()?.pages.find(p => p.kind === 'flow' ? p.lines.some(l => ids.has(l.blockId)) || p.elements?.some(e=>e.blockId&&ids.has(e.blockId)) : ids.has(p.blockId)); if (page) host.choosePage(page.number); }); const row = node('div'); row.setAttribute('role', 'listitem'); row.append(b);
      if (kind !== 'book') {
        row.className = 'outline-item';
        const more = node('button'); more.type = 'button'; more.className = 'icon-button outline-more'; more.dataset.menuItemId = scope;
        more.setAttribute('aria-label', label + 'の操作'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-controls', 'outline-menu'); more.setAttribute('aria-expanded', 'false'); more.append(iconElement('ellipsis'));
        more.addEventListener('click', () => openItemMenu(selection, scope, more));
        more.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); openItemMenu(selection, scope, more); } });
        row.append(more);
      }
      parent.append(row);return row;
    };
    item('本全体', 'book', { kind: 'book' }, 'book', new Set(flattenDocument(host.book().document).map(b => b.id)));
    for (const section of host.book().document.children) {
      const h = section.children.find(b => b.id === section.headingId), title = h?.kind === 'heading' ? h.inlines.map(i => i.kind === 'ruby' ? i.base : i.text).join('') : '本文';
      let parent=list;
      if (section.role === 'chapter') {
        const row=item(title || '章', section.id, { kind: 'chapter', id: section.id }, 'chapter', new Set(section.children.map(b => b.id)));
        if(section.children.some(b=>b.kind==='specialPage')){
          const children=node('div');children.className='outline-children';children.setAttribute('role','list');children.hidden=folded.has(section.id);
          const toggle=node('button');toggle.append(iconElement('chevron-right'));toggle.className='outline-fold';toggle.type='button';toggle.setAttribute('aria-label',`${title}の構成を開閉`);toggle.setAttribute('aria-expanded',String(!children.hidden));
          toggle.addEventListener('click',()=>{if(folded.has(section.id))folded.delete(section.id);else folded.add(section.id);children.hidden=folded.has(section.id);toggle.setAttribute('aria-expanded',String(!children.hidden));});row.className='outline-item outline-chapter';row.prepend(toggle);row.append(children);parent=children;
        }
      }
      for (const ref of section.children) if (ref.kind === 'specialPage') { const p = special(ref.pageId); if (p) item(p.name, p.id, { kind: 'special', id: p.id }, 'special', new Set([ref.id]),parent); }
    }
    if (focused) list.querySelector<HTMLButtonElement>(`[data-item-id="${focused}"]`)?.focus({ preventScroll: true });
  }
  function assets(): void {
    const book = host.book(), usage = book.assets.map(asset => assetReferences(book, asset.id).length);
    const key = JSON.stringify(book.assets.map((asset, index) => [asset.id, asset.name, asset.bytes, asset.images.length, usage[index]])), thumbnails = book.assets.map(asset => asset.images[0]!.dataUrl);
    if (key === assetListKey && thumbnails.every((url, index) => url === assetThumbnails[index])) return;
    assetListKey = key; assetThumbnails = thumbnails;
    const list = el('asset-list'); list.replaceChildren();
    if (!book.assets.length) { const p = node('p', '挿絵や完成ページを、ここに読み込みます。'); p.className = 'empty-view'; list.append(p); }
    for (const [index, asset] of book.assets.entries()) {
      const card = node('div'); card.className = 'asset-card'; const img = node('img'); img.className = 'asset-thumb'; img.src = asset.images[0]!.dataUrl; img.alt = asset.name;
      const used=usage[index]!, body = node('div'); body.append(node('p', asset.name), node('small', `${asset.images.length}ページ · ${Math.max(.1,asset.bytes / 1024).toFixed(1)} KB · ${used}件が参照`));
      button(body, 'ページとして挿入', () => {
        if(asset.images.length===1){change(b=>{const inserted=insertAssetPages(b,asset.id,1,1,insertionAnchor());host.select({kind:'special',id:inserted.ids[0]!});return inserted.book;});return;}
        insertingAssetId=asset.id;assetAnchor=insertionAnchor();input('asset-insert-from').value='1';input('asset-insert-to').value=String(asset.images.length);input('asset-insert-from').max=input('asset-insert-to').max=String(asset.images.length);el('asset-insert-name').textContent=asset.name;
        el('asset-insert-error').hidden=true;el<HTMLDialogElement>('asset-insert-dialog').showModal();
      });
      const manage=details('管理',body);button(manage,'差し替える…',()=>openAssetImport(asset.id));const remove=button(manage,'素材を削除',()=>{change(b=>removeUnusedAsset(b,asset.id));sync(true);});remove.disabled=used>0;remove.title=used?'参照を外すと削除できます':'';
      card.append(img, body); list.append(card);
    }
  }
  const insertionAnchor = (): string | undefined => { const s = host.selection(); return s.kind === 'special' ? flattenDocument(host.book().document).find(b => b.kind === 'specialPage' && b.pageId === s.id)?.id : s.kind === 'chapter' || s.kind === 'block' ? s.id : undefined; };
  const pageOptions = () => [['','本全体に従う'],...host.book().styles.pages!.map(p=>[p.id,p.name])] as [string,string][];
  function pageDecorations(parent: HTMLElement, id: string): void {
    for (const [key,label] of [['showFolio','本のノンブル'],['showHeads','本の柱']] as const) {
      field(parent,label,`special-${key}`,String(special(id).localStyle?.[key] ?? ''),v => {const local={...special(id).localStyle};if(v==='')delete local[key];else local[key]=v==='true';update(id,{localStyle:local});sync(true);},[['','本の設定に従う'],['false','付けない'],['true','付ける']]);
    }
  }
  function pageStyleFields(parent: HTMLElement, prefix: string, current: ()=>{pageStyleId?:string;localStyle?:PageProperties}, edit:(patch:object)=>void): void {
    const d=details('このページの版面 / 詳細',parent);
    field(d,'版面のスタイル',`${prefix}-page-style`,current().pageStyleId??'',v=>edit({pageStyleId:v||undefined}),pageOptions());
    styleFields(d,prefix,'page',()=>current().localStyle??{},value=>edit({localStyle:value}),['showHeads','showFolio']);
    button(actions(d),'版面の変更をリセット',()=>{edit({pageStyleId:undefined,localStyle:undefined});sync(true);});
  }
  function pageFields(id: string, parent: HTMLElement): void {
    const p = special(id); field(parent, 'ページ名', 'special-name', p.name, v => update(id, { name: v.slice(0, 100) }));
    field(parent, 'テンプレート', 'special-template', p.template, v => update(id, { template: v as 'standard' | 'minimal' }), [['standard', '標準'], ['minimal', '余白を広く']]);
    const keys = p.role === 'colophon' ? [['title', '書名'], ['author', '著者'], ['circle', 'サークル / 制作'], ['date', '発行日'], ['printer', '印刷所'], ['url', 'URL'], ['note', '注意書き']] : p.role === 'toc' ? [['title', '表題']] : [['title', p.role === 'chapter-title' ? '章名' : '書名'], ['subtitle', '副題'], ['author', '著者']];
    for (const [key, name] of keys) field(parent, name!, `special-${key}`, p.fields[key!] ?? '', v => update(id, { fields: { ...special(id).fields, [key!]: v } }), undefined, key === 'note');
    if (p.role === 'toc') {
      const toc = () => special(id).toc ?? { depth: 1 as const, fontPt: 9, indentMm: 3 };
      field(parent, '含める見出し', 'toc-depth', toc().depth, v => update(id, { toc: { ...toc(), depth: Number(v) as 1 | 2 | 3 } }), [['1', '見出し1'], ['2', '見出し1・2'], ['3', '見出し1・2・3']]);
      const item = details('目次の文字と字下げ', parent);
      field(item, '文字サイズ / pt', 'toc-font', toc().fontPt, v => update(id, { toc: { ...toc(), fontPt: Number(v) } }));
      field(item, '階層ごとの字下げ / mm', 'toc-indent', toc().indentMm, v => update(id, { toc: { ...toc(), indentMm: Number(v) } }));
      caption('見出しとノンブルを自動更新します。', parent);
    }
    pageDecorations(parent,id);
    const d = details('詳細 / 自由ページへ', parent);
    caption('このページだけ配置を編集します。本文の組版とは分離します。目次を変換すると、その時点の項目と番号が固定されます。元のテンプレート内容も保持します。', d);
    button(actions(d), '自由ページに変換', () => {
      const rendered = host.result()?.pages.filter(p => p.kind === 'structured' && p.pageId === id) ?? [];
      if (!rendered.length) return;
      change(b => {
        let next = convertToFree(b,id,rendered[0]!.kind !== 'flow' ? rendered[0]!.elements as PageElement[] : []), previous = id;
        for (const [index,page] of rendered.slice(1).entries()) {
          if(page.kind !== 'structured') continue;
          const anchor = flattenDocument(next.document).find(b=>b.kind==='specialPage'&&b.pageId===previous)!.id, added=addSpecialPage(next,'free',anchor);
          next=updateSpecialPage(added.book,added.id,{name:`${p.name} ${index+2}`,elements:page.elements as PageElement[],...(p.pageStyleId?{pageStyleId:p.pageStyleId}:{}),...(p.localStyle?{localStyle:p.localStyle}:{})});previous=added.id;
        }
        return next;
      }); sync(true);
    }, 'convert-free');
    pageStyleFields(d,'special',()=>special(id),patch=>update(id,patch));
  }
  function assetPicker(parent: HTMLElement, p: SpecialPageDefinition): void {
    field(parent,'配置','special-image-mode',p.imageMode??(p.role==='external'?'external':'page'),v=>{const local={...special(p.id).localStyle};if(v==='external'){local.showHeads??=false;local.showFolio??=false;}update(p.id,{imageMode:v as SpecialPageDefinition['imageMode'],localStyle:local});sync(true);},[['page','独立した挿絵ページ'],['flow','本文の途中に入れる'],['spread','見開きでつなげる'],['bleed','端まで広げる（裁ち落とし）'],['external','外部の完成ページ']]);
    if(p.imageMode==='spread')caption('偶数ページから見開き全体へ配置します。必要なら前に空白ページを挿入します。',parent);
    field(parent, '素材', 'special-asset', p.assetId ?? '', v => { update(p.id, { assetId: v || null, assetPage: 1 }); sync(true); }, [['', '素材を選ぶ'], ...host.book().assets.map(a => [a.id, a.name] as const)]);
    const asset = host.book().assets.find(a => a.id === p.assetId);
    if (asset && asset.images.length > 1) field(parent, '素材内のページ', 'special-asset-page', p.assetPage, v => update(p.id, { assetPage: Number(v) }), asset.images.map((_, i) => [String(i + 1), `${i + 1}ページ`]));
    field(parent, '紙面への合わせ方', 'special-fit', p.fit, v => update(p.id, { fit: v as 'contain' | 'cover' }), [['contain', '全体を収める'], ['cover', '紙面いっぱい（端を切る）']]);
    const captionDetails = details('図の説明', parent);
    field(captionDetails, '説明と図番号', 'caption-mode', p.caption ? p.caption.numbered ? 'numbered' : 'plain' : '', v => { update(p.id, { caption: v ? { text: special(p.id).caption?.text ?? '', fontPt: special(p.id).caption?.fontPt ?? 8, numbered: v === 'numbered' } : undefined }); sync(true); }, [['', '付けない'], ['plain', '説明のみ'], ['numbered', '図番号と説明']]);
    if (p.caption) {
      const text = field(captionDetails, '説明', 'caption-text', p.caption.text, v => update(p.id, { caption: { ...special(p.id).caption!, text: v } }), undefined, true) as HTMLTextAreaElement;
      text.maxLength = 1000;
      field(captionDetails, '文字サイズ / pt', 'caption-font', p.caption.fontPt, v => update(p.id, { caption: { ...special(p.id).caption!, fontPt: Number(v) } }));
    }
    pageDecorations(parent,p.id);
    caption('素材ビューから読み込んだ画像・PDFを指定します。', parent);
    const info=node('p');info.className='setting-caption';info.dataset.imageInfo=p.id;parent.append(info);
    if(p.imageMode==='bleed')field(parent,'素材の裁ち落とし幅 / mm','special-bleed',p.bleedMm??3,v=>update(p.id,{bleedMm:Number(v)}));
    caption('素材に含まれる塗り足し幅です。出力側の塗り足しは書き出しで設定します。', parent);
    button(actions(parent), '素材を読み込む', () => openAssetImport());
    pageStyleFields(parent,'special',()=>special(p.id),patch=>update(p.id,patch));
  }
  function freePage(id: string, parent: HTMLElement, elementId?: string): void {
    const p = special(id);
    const ids=selectedElementIds(host.selection());
    const layers = details('要素と重なり順', parent); layers.id = 'free-layers'; layers.open = !ids.length || expandedLayers.has(id);
    layers.querySelector('summary')!.addEventListener('click', () => { if (layers.open) expandedLayers.delete(id); else expandedLayers.add(id); });
    const list = node('div'); list.className = 'element-list'; list.setAttribute('aria-label', '重なり順（上が手前）'); layers.append(list);
    for (const e of [...p.elements].reverse()) {
      const row=node('div');row.className='element-row';list.append(row);
      if(p.elements.length>1){const box=node('input');box.type='checkbox';box.checked=ids.includes(e.id);box.setAttribute('aria-label',`${e.kind==='text'?e.text.slice(0,22)||'空のテキスト':e.kind==='image'?'画像':e.kind==='line'?'線':'矩形'}を追加選択`);box.addEventListener('change',()=>{expandedLayers.add(id);const next=box.checked?[...new Set([...ids,e.id])]:ids.filter(x=>x!==e.id);host.select({kind:'special',id,...(next[0]?{elementId:next[0],elementIds:next}:{})});});row.append(box);}
      const b = button(row, `${e.locked ? '固定 · ' : ''}${e.kind === 'text' ? e.text.slice(0, 22) || '空のテキスト' : e.kind === 'image' ? '画像' : e.kind === 'line' ? '線' : '矩形'}`, () => { expandedLayers.add(id); host.select({ kind: 'special', id, elementId: e.id }); });
      b.addEventListener('click',event=>{if(!event.shiftKey)return;event.stopImmediatePropagation();expandedLayers.add(id);const selected=ids.includes(e.id)?ids.filter(x=>x!==e.id):[...ids,e.id];host.select({kind:'special',id,...(selected[0]?{elementId:selected[0],elementIds:selected}:{})});},{capture:true});
      b.setAttribute('aria-pressed', String(ids.includes(e.id)));
      b.dataset.elementRow = e.id;
    }
    const a = actions(layers);
    for (const [kind, label] of [['text', '＋ 文字'], ['image', '＋ 画像'], ['line', '＋ 線'], ['rect', '＋ 矩形']] as const) button(a, label, () => {
      const current = host.book(), copy = { ...current, document: structuredClone(current.document) }, e = newElement(copy, kind);
      change(() => updateSpecialPage(copy, id, { elements: [...special(id).elements, e] })); host.select({ kind: 'special', id, elementId: e.id });
    }, `add-element-${kind}`);
    const e = p.elements.find(e => e.id === elementId);
    if(ids.length>1){const g=group(undefined,parent),align=actions(g);for(const [value,label]of [['left','左端'],['center-x','左右中央'],['right','右端'],['top','上端'],['center-y','上下中央'],['bottom','下端']]as const)button(align,label,()=>{change(b=>{let next=b;for(const selected of ids)if(!specialFrom(next,id).elements.find(e=>e.id===selected)?.locked)next=alignPageElement(next,id,selected,value);return next;});sync(true);});const a=actions(g);for(const [action,label]of [['duplicate','複製'],['lock','固定 / 解除'],['delete','削除']]as const)button(a,label,()=>elementAction(action));}
    else if (e) elementFields(id, e, group(undefined, parent));
    const d=details('自由ページの詳細',parent);pageDecorations(d,id);field(d,'移動を揃える間隔 / mm（0で自由）','free-snap',p.snapMm??1,v=>update(id,{snapMm:Number(v)}));
    pageStyleFields(d,'special',()=>special(id),patch=>update(id,patch));
    if (p.originalTemplate) button(actions(details('元のテンプレート', parent)), 'テンプレートへ戻す', () => {
      const original = special(id).originalTemplate!; update(id, { representation: 'template', template: original.template, fields: original.fields }); host.select({ kind: 'special', id }); sync(true);
    }, 'restore-template');
  }
  function elementFields(pageId: string, element: PageElement, parent: HTMLElement): void {
    const id = element.id;
    const edit = (patch: object) => update(pageId, { elements: special(pageId).elements.map(e => e.id === id ? { ...e, ...patch } : e) });
    if (element.kind === 'text') {
      field(parent, 'テキスト', 'element-text', element.text, v => edit({ text: v }), undefined, true);
      field(parent,'書体','element-font-family',element.fontFamily??'',v=>edit({fontFamily:v||undefined}),[['','本の書体に従う'],...FONT_CATALOG.map(font=>[font.family,font.label] as const)]);
      field(parent, '文字サイズ / pt', 'element-font', element.fontPt, v => edit({ fontPt: Number(v) }));
      iconChoices(parent, 'element-align', '揃え', alignmentOptions.filter(([value]) => value !== ''), element.alignment, v => edit({ alignment: v }), element.direction === 'vertical');
      field(parent, '書字方向', 'element-direction', element.direction, v => edit({ direction: v }), [['horizontal', '横書き'], ['vertical', '縦書き']]);
      iconChoices(parent, 'element-weight', '太さ', weightOptions.filter(([value]) => value !== ''), element.fontWeight, v => edit({ fontWeight: Number(v) }));
    } else if (element.kind === 'image') {
      field(parent, '素材', 'element-asset', element.assetId, v => edit({ assetId: v, assetPage: 1 }), [['unassigned', '素材を選ぶ'], ...host.book().assets.map(a => [a.id, a.name] as const)]);
      const asset = host.book().assets.find(a => a.id === element.assetId);
      if (asset && asset.images.length > 1) field(parent, '素材内のページ', 'element-asset-page', element.assetPage, v => edit({ assetPage: Number(v) }), asset.images.map((_, i) => [String(i + 1), `${i + 1}ページ`]));
      field(parent, 'フィット', 'element-fit', element.fit, v => edit({ fit: v }), [['contain', '全体を収める'], ['cover', '枠いっぱい']]);
    } else { field(parent, '色', 'element-color', element.color, v => edit({ color: v })); field(parent, '線幅 / mm', 'element-stroke', element.strokeMm, v => edit({ strokeMm: Number(v) })); }
    const d = details('位置と大きさ / mm', parent);
    for (const [key, label] of [['xMm', '左から'], ['yMm', '上から'], ['widthMm', '幅'], ['heightMm', '高さ']] as const) field(d, label, `element-${key}`, element[key], v => edit({ [key]: Number(v) }));
    const align=actions(d); for(const [value,label] of [['left','左端'],['center-x','左右中央'],['right','右端'],['top','上端'],['center-y','上下中央'],['bottom','下端']] as const)button(align,label,()=>{change(b=>alignPageElement(b,pageId,id,value));sync(true);},`align-${value}`);
    const layer = actions(parent); for (const [action, label] of [['backward', '背面へ'], ['forward', '前面へ'], ['back', '最背面'], ['front', '最前面']] as const) button(layer, label, () => elementAction(action), `element-${action}`);
    const a = actions(parent); button(a, '複製', () => elementAction('duplicate'), 'duplicate-element'); button(a, element.locked ? '固定を解除' : '固定', () => elementAction('lock'), 'lock-element'); button(a, '削除', () => elementAction('delete'), 'delete-element');
    if (element.locked) parent.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea, fieldset').forEach(e => { (e as HTMLInputElement | HTMLFieldSetElement).disabled = true; });
  }
  function elementAction(action: Parameters<typeof editPageElement>[3]): void {
    const selected = host.selection(); if (selected.kind !== 'special' || !selected.elementId) return;
      change(book => { const result = editPageElements(book, selected.id, selectedElementIds(selected), action); host.select({ kind: 'special', id: selected.id, ...(result.ids[0] ? { elementId: result.ids[0],...(result.ids.length>1?{elementIds:result.ids}:{}) } : {}) }, false); return result.book; }); sync(true);
  }
  function runningFields(id: string, parent: HTMLElement): void {
    const current = (): RunningElement => host.book().runningElements.find(e => e.id === id)!;
    const e = current(), edit = (patch: Partial<RunningElement>) => change(b => ({ ...b, runningElements: b.runningElements.map(e => e.id === id ? { ...e, ...patch } : e) }));
    scopeField(parent,'running-scope',e.scope,v=>{edit({scope:v});sync(true);},true);
    if(e.scope.kind==='pages') {caption('通しページに固定されます。文章を増やしても章には追従しません。',parent);field(parent,'開始ページ','running-from',e.scope.from,v=>edit({scope:{kind:'pages',from:Number(v),to:current().scope.kind==='pages'? (current().scope as Extract<Scope,{kind:'pages'}>).to:null}}));field(parent,'終了ページ（空欄は最後まで）','running-to',e.scope.to??'',v=>edit({scope:{kind:'pages',from:(current().scope as Extract<Scope,{kind:'pages'}>).from,to:v?Number(v):null}}));}
    field(parent, '内容', 'running-content', e.content.kind, v => { edit({ content: v === 'text' ? { kind: 'text', text: '' } : { kind: v as 'title' | 'author' | 'chapter' | 'heading' | 'pageNumber' } }); sync(true); }, [['title', '書名'], ['chapter', '現在の章名'], ['heading', '現在の見出し'], ['author', '著者'], ['text', '固定の文字']]);
    if (e.content.kind === 'text') field(parent, '文字', 'running-text', e.content.text, v => edit({ content: { kind: 'text', text: v } }));
    field(parent, '配置', 'running-position', e.position, v => edit({ position: v as DecorationPosition }), [['top-outer', '上・小口'], ['top-center', '上・中央'], ['top-inner', '上・ノド'], ['bottom-outer', '下・小口'], ['bottom-center', '下・中央'], ['bottom-inner', '下・ノド']]);
    field(parent, '左右ページ', 'running-side', e.side, v => edit({ side: v as RunningElement['side'] }), [['both', '両方'], ['odd', '奇数ページ'], ['even', '偶数ページ']]);
    field(parent, '章の最初のページ', 'running-first', String(e.hideOnSectionFirst), v => edit({ hideOnSectionFirst: v === 'true' }), [['false', '表示する'], ['true', '非表示にする']]);
    field(parent,'書体','running-font-family',e.fontFamily??'',v=>change(b=>({...b,runningElements:b.runningElements.map(item=>{if(item.id!==id)return item;const next={...item};if(v)next.fontFamily=v;else delete next.fontFamily;return next;})})),[['','本の書体に従う'],...FONT_CATALOG.map(font=>[font.family,font.label] as const)]);
    const d = details('詳細', parent); field(d, '大きさ / pt', 'running-size', e.fontPt, v => edit({ fontPt: Number(v) })); field(d, '端から / mm', 'running-inset', e.insetMm, v => edit({ insetMm: Number(v) }));
    button(actions(parent), 'この柱を削除', () => { change(b => ({ ...b, runningElements: b.runningElements.filter(e => e.id !== id) })); host.select({ kind: 'book' }); });
  }
  function pagesFields(numbers: number[], parent: HTMLElement): void {
    caption('この指定はページの位置に固定されます。本文が増えても章には追従しません。字数や行数を変える設定は本・段落に適用します。', parent);
    const existing = host.book().pageOverrides.find(r => r.pages.length === numbers.length && r.pages.every(n => numbers.includes(n)));
    const edit = (patch: object) => change(b => {
      const current = b.pageOverrides.find(r => r.pages.length === numbers.length && r.pages.every(n => numbers.includes(n)));
      const rule = { ...(current ?? { id: `physical-${b.document.nextId}`, pages: [...numbers] }), ...patch };
      const copy = { ...b, document: structuredClone(b.document), pageOverrides: current ? b.pageOverrides.map(r => r.id === current.id ? rule : r) : [...b.pageOverrides, rule] };
      if (!current) copy.document.nextId++; return copy;
    });
    field(parent, 'ノンブル', 'pages-folio', existing?.folio === false ? 'hide' : 'inherit', v => edit({ folio: v === 'hide' ? false : undefined }), [['inherit', '本全体の設定に従う'], ['hide', 'このページでは非表示']]);
    field(parent, '柱', 'pages-heads', existing?.hideHeads ? 'hide' : 'inherit', v => edit({ hideHeads: v === 'hide' ? true : undefined }), [['inherit', '範囲の設定に従う'], ['hide', 'このページでは非表示']]);
    field(parent, '紙の色', 'pages-paper', existing?.paperColor ?? '', v => edit({ paperColor: v || undefined }), [['', '本全体の設定に従う'], ...PAPER_COLORS, ...(existing?.paperColor&&!PAPER_COLORS.some(([value])=>value===existing.paperColor)?[[existing.paperColor,'カスタム'] as const]:[])]);
    if (existing) button(actions(parent), 'このページ範囲の例外を解除', () => { change(b => ({ ...b, pageOverrides: b.pageOverrides.filter(r => r.id !== existing.id) })); sync(true); }, 'reset-pages');
  }
  function chapterFields(id: string, parent: HTMLElement): void {
    const section = host.book().document.children.find(s => s.id === id)!;
    const heading = section.children.find(b => b.id === section.headingId);
    field(parent, '章名', 'chapter-title', heading?.kind === 'heading' ? heading.inlines.map(i => i.kind === 'ruby' ? i.base : i.text).join('') : '', v => change(b => renameChapter(b, id, v.slice(0, 200))));
    field(parent, '開始ページ', 'chapter-start', section.start ?? section.localStyle?.start ?? '', v => change(b => ({ ...b, document: { ...b.document, children: b.document.children.map(s => {if(s.id!==id)return s;const next={...s,localStyle:{...s.localStyle}};delete next.start;if(v)next.localStyle.start=v as 'continuous'|'next'|'left'|'right'|'recto';else delete next.localStyle.start;return next;}) } })), [['','章スタイルに従う（通常は本文の続き）'],['continuous', '本文の続き'], ['next', '改ページ'], ['recto', '改丁（奇数ページ）'], ['left', '左ページ'], ['right', '右ページ']]);
    caption('開始位置は章に保存します。前の文章が増えても追従します。', parent);
    if (heading) button(actions(parent), '見出しの書式を調整', () => host.select({ kind: 'block', id: heading.id }));
    button(actions(parent), 'この章の柱を設定', () => addRunning({ kind: 'section', sectionId: id }));
    const d = details('章全体の書式', parent);
    const current=()=>host.book().document.children.find(s=>s.id===id)!,edit=(patch:object)=>change(b=>({...b,document:{...b.document,children:b.document.children.map(s=>s.id===id?{...s,...patch}:s)}}));
    const sectionLocal=(patch:object)=>{const next={...current().localStyle} as Record<string,unknown>;for(const [key,value] of Object.entries(patch))if(value===undefined)delete next[key];else next[key]=value;edit({localStyle:next});};
    const numbering = details('ノンブルの区切り', parent);
    field(numbering, 'この章の開始番号', 'chapter-number-start', section.localStyle?.numberStart === undefined ? '' : section.localStyle.numberStart, v => sectionLocal({ numberStart: v === '' ? undefined : Number(v) }));
    field(numbering, '番号の表し方', 'chapter-number-format', section.localStyle?.numberFormat ?? '', v => sectionLocal({ numberFormat: v || undefined }), [['', '前の系列に従う'], ['decimal', '1, 2, 3'], ['roman', 'i, ii, iii'], ['Roman', 'I, II, III']]);
    caption('番号を区切る章は、新しいページから始まります。空欄に戻すと指定を解除します。', numbering);
    field(d,'章のスタイル','chapter-style',section.styleId??'',v=>edit({styleId:v||undefined}),[['','本全体に従う'],...host.book().styles.sections!.map(s=>[s.id,s.name] as const)]);
    field(d,'版面のスタイル','chapter-page-style',section.localStyle?.pageStyleId??'',v=>sectionLocal({pageStyleId:v||undefined}),pageOptions());
    field(d,'本文のスタイル','chapter-body-style',section.localStyle?.paragraphStyleId??'',v=>sectionLocal({paragraphStyleId:v||undefined}),[['','本全体に従う'],...host.book().styles.paragraphs.map(s=>[s.id,s.name] as const)]);
    const pageDetails=details('この章だけの版面',d);styleFields(pageDetails,'chapter-page','page',()=>current().localStyle?.page??{},page=>sectionLocal({page}));
    styleFields(d,'chapter-text','character',()=>current().localStyle?.character??{},character=>sectionLocal({character}));
    styleFields(d,'chapter-paragraph','paragraph',()=>current().localStyle?.paragraph??{},paragraph=>sectionLocal({paragraph}));
    button(actions(d),'この章の書式をリセット',()=>{edit({localStyle:undefined,start:undefined});change(b=>({...b,overrides:b.overrides.filter(r=>r.id!==`chapter-${id}`)}));sync(true);},'reset-chapter-style');
  }
  function scopeField(parent:HTMLElement,id:string,scope:Scope,edit:(scope:Scope)=>void,physical=false,fromId?:string): HTMLSelectElement {
    const b=host.book(),at=b.metadata?.selected??1,p=host.result()?.pages[at-1],anchor=fromId??(scope.kind==='untilSection'?scope.fromId:p?.lines[0]?.blockId??(p?.kind==='flow'?p.elements?.[0]?.blockId:p?.blockId));
    const options:[string,string][]=[['book','本全体'],...b.document.children.map(s=>[s.id,s.role==='chapter'?`章：${s.children.filter(b=>b.kind==='heading')[0]?.inlines.map(i=>i.kind==='ruby'?i.base:i.text).join('')??s.id}`:'本文セクション'] as [string,string])];
    if(anchor)options.push(['anchor','この位置から次のセクションまで']);if(physical)options.push(['page','このページのみ'],['pages','通しページ範囲']);
    const value=scope.kind==='book'?'book':scope.kind==='section'?scope.sectionId:scope.kind==='untilSection'?'anchor':scope.kind==='pages'?scope.to===scope.from?'page':'pages':'current';if(value==='current')options.push(['current','現在の構造範囲']);
    return field(parent,'適用範囲',id,value,v=>{if(v==='current')return;edit(v==='book'?{kind:'book'}:v==='anchor'&&anchor?{kind:'untilSection',fromId:anchor}:v==='page'||v==='pages'?{kind:'pages',from:at,to:v==='page'?at:null}:{kind:'section',sectionId:v});},options) as HTMLSelectElement;
  }
  function addRunning(scope: RunningElement['scope']): void {
    change(b => { const id = `running-${b.document.nextId}`; const next = { ...b, document: { ...b.document, nextId: b.document.nextId + 1 }, runningElements: [...b.runningElements, { id, scope, content: { kind: scope.kind === 'book' ? 'title' as const : 'chapter' as const }, position: 'top-center' as const, side: 'both' as const, fontPt: 7, insetMm: 8, hideOnSectionFirst: false }] }; host.select({ kind: 'running', id }); return next; }); sync(true);
  }
  function sync(force = false): void {
    const chosen = host.selection(), mode = host.inspectorMode(), s: Selection = mode !== 'selection' ? { kind: 'book' } : chosen, b = host.book();
    outline(); assets();
    el('book-settings').hidden = mode !== 'body'; el('typography-settings').hidden = mode !== 'styles';
    el('block-inspector').hidden = !['block', 'range'].includes(s.kind);
    el('inspect-book').setAttribute('aria-selected', String(mode === 'body')); el('inspect-styles').setAttribute('aria-selected', String(mode !== 'body'));
    el('inspect-book').tabIndex = mode === 'body' ? 0 : -1; el('inspect-styles').tabIndex = mode === 'body' ? -1 : 0;
    el('edit-target-row').hidden = mode === 'body';
    const picker = el<HTMLSelectElement>('typography-target'), currentTarget = el<HTMLOptionElement>('edit-current-target');
    currentTarget.hidden = chosen.kind === 'book'; currentTarget.disabled = chosen.kind === 'book';
    if (mode === 'selection') picker.value = 'context';
    else if (picker.value === 'context') picker.value = 'all';
    el('edit-selection').hidden = chosen.kind === 'book';
    el('preview-hint').dataset.selected = String(chosen.kind !== 'book');
    el('inspector-scope').parentElement!.dataset.scope = s.kind;
    const description = chosen.kind === 'block' ? flattenDocument(b.document).find(x => x.id === chosen.id) : undefined;
    const excerpt = description && 'inlines' in description ? description.inlines.map(i => i.kind === 'ruby' ? i.base : i.text).join('').slice(0, 26) : '';
    el('selection-hint').textContent = chosen.kind === 'range' ? `${chosen.ids.length}段落を選択` : chosen.kind === 'block' ? `${excerpt || '空の段落'}` : chosen.kind === 'pages' ? `通しページ ${chosen.numbers.join('・')}` : chosen.kind === 'book' ? '' : chosen.kind === 'special' ? `${special(chosen.id)?.name ?? 'ページ'}` : '選択した箇所';
    const labels = { book: mode === 'styles' ? '書式' : '本の設定', block: '選択した文章', range: '選択範囲', chapter: '章の設定', special: s.kind === 'special' ? special(s.id)?.name ?? 'ページ' : 'ページ', running: '柱', pages: '選択ページ' };
    currentTarget.textContent = chosen.kind === 'range' ? `いまの範囲 · ${chosen.ids.length}段落` : chosen.kind === 'special' ? special(chosen.id)?.name ?? '自由ページ' : chosen.kind === 'chapter' ? 'いまの章' : chosen.kind === 'pages' ? `通しページ ${chosen.numbers.join('・')}` : chosen.kind === 'running' ? 'いまの柱' : chosen.kind === 'block' ? excerpt || 'いまの段落' : 'いまの対象';
    let canvasTargets = 0;
    if (chosen.kind === 'special') {
      const page = special(chosen.id), ids = selectedElementIds(chosen), elements = page.elements.filter(e => ids.includes(e.id));
      canvasTargets = elements.length;
      if (elements.length) {
        const e = elements[0]!, name = elements.length > 1 ? `${elements.length}要素` : e.kind === 'text' ? '文字' : e.kind === 'image' ? '画像' : e.kind === 'line' ? '線' : '矩形';
        currentTarget.textContent = `${page.name} · ${name}`;
      }
    }
    el('settings-heading').textContent = labels[s.kind];
    el('settings-heading').classList.toggle('sr-only', mode !== 'body');
    if (mode === 'styles') el('settings-heading').textContent = `${picker.selectedOptions[0]?.textContent ?? '全体の基本'}の書式`;
    el('inspector-scope').textContent = s.kind === 'book' ? mode === 'styles' ? '同じ書式の文章をまとめて変更' : '判型・版面・ページの装飾' : s.kind === 'range' ? '原稿にも反映' : s.kind === 'chapter' ? `この章全体 · ${range(new Set(b.document.children.find(x => x.id === s.id)?.children.map(x => x.id) ?? []))}` : s.kind === 'pages' ? '通しページに固定' : s.kind === 'running' ? '内容・配置・適用範囲' : s.kind === 'block' ? '原稿にも反映' : 'このページに適用';
    if (mode === 'selection' && canvasTargets) { el('settings-heading').textContent = currentTarget.textContent; el('inspector-scope').textContent = canvasTargets > 1 ? '選んだ要素に適用' : 'この要素に適用'; }
    if(s.kind==='block'||s.kind==='range'){const target=host.textTarget();if(target.scope!=='selection'){el('settings-heading').textContent=target.label;currentTarget.textContent=target.label;el('inspector-scope').textContent=`${target.count}段落 · 原稿にも反映`;}}
    for (const choice of document.querySelectorAll<HTMLElement>('[data-choice-field]:not(#element-align)')) choice.dataset.vertical = String(b.style.writingMode === 'vertical-rl');
    const key = JSON.stringify(s);
    if (key !== contextKey || force) {
      const detailPath = (detail: HTMLDetailsElement): string => {
        const parts: string[] = []; let current: HTMLDetailsElement | null = detail;
        while (current && context.contains(current)) { parts.unshift(current.querySelector(':scope > summary')?.textContent ?? ''); current = current.parentElement?.closest('details') ?? null; }
        return parts.join('/');
      };
      const sameTarget = key === contextKey, detailState = new Map(sameTarget ? [...context.querySelectorAll<HTMLDetailsElement>('details')].map(d => [detailPath(d), d.open] as const) : []);
      const focused = sameTarget && context.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '';
      contextKey = key; context.replaceChildren();
      if (s.kind === 'special') {
        const p = special(s.id); if (p) { const g = group(); if (p.representation === 'template') pageFields(s.id, g); else if (p.representation === 'asset') assetPicker(g, p); else freePage(s.id, g, s.elementId); }
      } else if (s.kind === 'chapter' && b.document.children.some(x => x.id === s.id)) chapterFields(s.id, group());
      else if (s.kind === 'running' && b.runningElements.some(e => e.id === s.id)) runningFields(s.id, group());
      else if (s.kind === 'pages' && s.numbers.length) pagesFields(s.numbers, group());
      else if (s.kind === 'block') {
        button(actions(context), '原稿で開く', () => host.revealSource(s.id), 'reveal-source');

      }
      if (sameTarget) for (const detail of context.querySelectorAll<HTMLDetailsElement>('details')) { const state = detailState.get(detailPath(detail)); if (state !== undefined) detail.open = state; }
      if (focused) { const control = document.getElementById(focused); if (control && context.contains(control) && control.offsetParent !== null) control.focus({ preventScroll: true }); }
    }
    for(const el of context.querySelectorAll<HTMLElement>('[data-image-info]')){const ref=flattenDocument(b.document).find(x=>x.kind==='specialPage'&&x.pageId===el.dataset.imageInfo),pages=host.result()?.pages??[],info=pages.flatMap(p=>{if(p.kind!=='flow')return p.pageId===el.dataset.imageInfo&&p.imageInfo?[p.imageInfo]:[];const at=p.elements?.findIndex(e=>e.blockId===ref?.id)??-1;return at>=0&&p.imageInfo?.[at]?[p.imageInfo[at]]:[];})[0];el.textContent=info?`${info.sourcePixels.join(' × ')} px · 配置後 約${Math.round(info.effectiveDpi)} dpi · 仕上がり ${info.trimMm.join(' × ')} mm${info.bleedMm?` · 塗り足し ${info.bleedMm} mm`:''}${info.originalMm?` · 元のPDF ${info.originalMm.map(n=>n.toFixed(1)).join(' × ')} mm`:''}`:'素材が未指定、または再組版中です。';}
    const convert=context.querySelector<HTMLButtonElement>('#convert-free');
    if(convert&&s.kind==='special'){const parts=host.result()?.pages.filter(p=>p.kind==='structured'&&p.pageId===s.id)??[],tooMany=parts.some(p=>p.kind!=='flow'&&p.elements.length>50);convert.disabled=!parts.length||tooMany;convert.textContent=parts.length>1?`全${parts.length}ページを自由ページに変換`:'自由ページに変換';convert.title=tooMany?'50要素を超えるページがあります。自動目次のまま使用してください。':'';}
    const heads = el('semantic-heads'); heads.replaceChildren();
    for (const h of b.runningElements) button(heads, `${h.content.kind === 'text' ? h.content.text : h.content.kind === 'chapter' ? '章名' : h.content.kind === 'title' ? '書名' : '柱'} · ${h.scope.kind === 'book' ? '本全体' : '範囲指定'}`, () => host.select({ kind: 'running', id: h.id }));
  }
  el('add-semantic-head').addEventListener('click', () => addRunning({ kind: 'book' }));
  el('add-book-item').addEventListener('click', () => el<HTMLDialogElement>('add-page-dialog').showModal());
  el('close-add-page').addEventListener('click', () => el<HTMLDialogElement>('add-page-dialog').close());
  el('confirm-add-page').addEventListener('click', () => {
    const role = el<HTMLSelectElement>('new-page-role').value, name = input('new-page-name').value;
    change(b => {
      if (role === 'chapter') { const next = addChapter(b, name); host.select({ kind: 'chapter', id: next.document.children.at(-1)!.id }); return next; }
      if (role === 'layout') { const result = createLayoutPage(b, el<HTMLSelectElement>('new-page-template').value as Parameters<typeof createLayoutPage>[1], name, insertionAnchor()); host.select({ kind: 'special', id: result.id }); return result.book; }
      const inserted = addSpecialPage(b, role as SpecialRole, insertionAnchor()), next = name ? updateSpecialPage(inserted.book, inserted.id, { name: name.slice(0, 100), fields: { ...specialFrom(inserted.book, inserted.id).fields, ...(role === 'title' || role === 'chapter-title' ? { title: name } : {}) } }) : inserted.book;
      host.select({ kind: 'special', id: inserted.id }); return next;
    });
    el<HTMLDialogElement>('add-page-dialog').close(); input('new-page-name').value = ''; sync(true);
  });
  el('new-page-role').addEventListener('change', () => { el('new-page-template-row').hidden = el<HTMLSelectElement>('new-page-role').value !== 'layout'; });
  const specialFrom = (b: BookModel, id: string) => b.specialPages.find(p => p.id === id)!;
  const itemMenu = el('outline-menu');
  let menuSelection: Selection | undefined, menuScope = '';
  function openItemMenu(selection: Selection, scope: string, trigger: HTMLButtonElement): void {
    const rect = trigger.getBoundingClientRect(); menuSelection = selection; menuScope = scope;
    host.select(selection, false);
    for (const button of itemMenu.querySelectorAll<HTMLButtonElement>('button')) button.disabled = host.book().sourceDraft !== undefined;
    itemMenu.style.left = Math.max(8, Math.min(window.innerWidth - 196, rect.right - 188)) + 'px';
    itemMenu.style.top = Math.max(8, Math.min(window.innerHeight - 160, rect.bottom + 4)) + 'px';
    if (!itemMenu.matches(':popover-open')) itemMenu.showPopover();
    listMenuTrigger()?.setAttribute('aria-expanded', 'true');
    itemMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  function listMenuTrigger(): HTMLButtonElement | null { return el('book-outline').querySelector<HTMLButtonElement>(`[data-menu-item-id="${menuScope}"]`); }
  const closeItemMenu = () => { if (itemMenu.matches(':popover-open')) itemMenu.hidePopover(); };
  itemMenu.addEventListener('toggle', () => { const open = itemMenu.matches(':popover-open'); listMenuTrigger()?.setAttribute('aria-expanded', String(open)); if (!open && !el<HTMLDialogElement>('move-item-dialog').open) listMenuTrigger()?.focus({ preventScroll: true }); });
  itemMenu.addEventListener('keydown', event => {
    if (event.key === 'Tab') { closeItemMenu(); return; }
    if (event.key === 'Escape') { event.preventDefault(); closeItemMenu(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...itemMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  });
  el('item-copy').addEventListener('click', () => {
    const s = menuSelection; closeItemMenu(); if (!s || !('id' in s)) return;
    change(book => { const copy = duplicateBookItem(book, s.id); host.select({ kind: s.kind === 'chapter' ? 'chapter' : 'special', id: copy.id }, false); return copy.book; }, '複製しました。');
    sync(true);
  });
  el('item-delete').addEventListener('click', () => {
    const s = menuSelection; closeItemMenu(); if (!s || !('id' in s)) return;
    change(book => removeBookItem(book, s.id), '構成から削除しました。元に戻す操作で復元できます。'); host.select({ kind: 'book' }, false);
    el('book-outline').querySelector<HTMLButtonElement>('.outline-row')?.focus();
  });
  el('item-move').addEventListener('click', () => {
    const s = menuSelection; if (!s || !('id' in s)) return;
    const targets = el<HTMLSelectElement>('move-item-target'); targets.replaceChildren();
    for (const section of host.book().document.children) {
      if (s.kind === 'chapter' && section.id === s.id) continue;
      const heading = section.children.find(b => b.id === section.headingId);
      if (section.role === 'chapter') targets.append(new Option(heading && 'inlines' in heading ? heading.inlines.map(r => r.kind === 'ruby' ? r.base : r.text).join('') : '章', section.id));
      if (s.kind !== 'chapter') for (const ref of section.children) if (ref.kind === 'specialPage' && ref.pageId !== s.id) targets.append(new Option(special(ref.pageId)?.name ?? 'ページ', ref.pageId));
    }
    if (!targets.options.length) { closeItemMenu(); host.notify('移動先の構成がありません。'); return; }
    el<HTMLDialogElement>('move-item-dialog').showModal(); closeItemMenu();
  });
  el('close-move-item').addEventListener('click', () => el<HTMLDialogElement>('move-item-dialog').close());
  el('move-item-dialog').addEventListener('close', () => listMenuTrigger()?.focus({ preventScroll: true }));
  el('confirm-move-item').addEventListener('click', () => {
    const s = menuSelection; if (!s || !('id' in s)) return;
    change(book => reorderBookItem(book, s.id, el<HTMLSelectElement>('move-item-target').value, el<HTMLSelectElement>('move-item-position').value as 'before' | 'after'), '構成を移動しました。');
    el<HTMLDialogElement>('move-item-dialog').close();
  });
  function openAssetImport(id?: string): void {replaceAssetId=id;input('asset-file').multiple=!id;input('asset-file').click();}
  el('add-asset').addEventListener('click', () => openAssetImport());
  el('close-asset-insert').addEventListener('click',()=>el<HTMLDialogElement>('asset-insert-dialog').close());
  el('confirm-asset-insert').addEventListener('click',()=>{
    if(!insertingAssetId)return;
    try{const inserted=insertAssetPages(host.book(),insertingAssetId,Number(input('asset-insert-from').value),Number(input('asset-insert-to').value),assetAnchor);host.change(inserted.book);host.select({kind:'special',id:inserted.ids[0]!});el<HTMLDialogElement>('asset-insert-dialog').close();sync(true);}
    catch(error){el('asset-insert-error').textContent=error instanceof Error?error.message:'ページ範囲を確認してください。';el('asset-insert-error').hidden=false;}
  });
  el('cancel-asset').addEventListener('click', () => abort?.abort());
  input('asset-file').addEventListener('change', async () => {
    const files = [...input('asset-file').files ?? []]; if (!files.length || abort) return;
    const before = host.book(), replaceId=replaceAssetId; abort = new AbortController(); el('asset-progress').hidden = false; el('cancel-asset').hidden = false; el('asset-progress').textContent = '端末内で素材を読み込んでいます…';
    try {
      if(replaceId&&files.length!==1)throw new Error('差し替える素材は一つずつ選んでください。');
      const assets: BookAsset[]=[];
      for(const [index,file] of files.entries())assets.push(await importAsset(file, `asset-${before.document.nextId+index}`, abort.signal, v => { el('asset-progress').textContent = `${index+1} / ${files.length} · ${v}`; }));
      // IDs are allocated at commit time; text edits during decoding are preserved.
      change(b => replaceId ? replaceBookAsset(b,replaceId,assets[0]!) : ({ ...b, document: { ...b.document, nextId: b.document.nextId + assets.length }, assets: [...b.assets, ...assets.map((asset,index)=>({...asset,id:`asset-${b.document.nextId+index}`}))] }), replaceId?'参照先を保って素材を差し替えました。':`${files.length}件の素材を追加しました。`);
      sync(true);
    } catch (error) { host.notify(error instanceof Error ? error.message : '素材を読み込めません。'); }
    finally { abort = undefined;replaceAssetId=undefined; el('asset-progress').hidden = true; el('cancel-asset').hidden = true; input('asset-file').value = '';input('asset-file').multiple=true; }
  });
  return { sync, elementAction, moveElements(pageId:string,ids:readonly string[],dx:number,dy:number){change(b=>movePageElements(b,pageId,ids,dx,dy));sync(true);}, resizeElement(pageId: string, elementId: string, width: number, height: number) { change(b => resizePageElement(b, pageId, elementId, width, height)); sync(true); }, moveElement(pageId: string, elementId: string, xMm: number, yMm: number) { change(b => movePageElement(b,pageId,elementId,xMm,yMm)); sync(true); } };
}
