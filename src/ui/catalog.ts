import type { BookModel, StyleCatalog, PageProperties, SectionProperties } from '../domain/model.js';
import { inheritedStyle, defaultCatalog } from '../domain/styles.js';
import { styleFields } from './style-fields.js';

/** Named styles are an optional deeper layer; the normal body controls remain the first stop. */
export function catalogEditor(parent: HTMLElement, host: { book(): BookModel; change(book: BookModel): void }): void {
  const details = document.createElement('details'); details.className = 'style-details'; details.id = 'shared-styles';
  const summary = document.createElement('summary'); summary.textContent = '共通スタイルを編集'; details.append(summary);
  const caption = document.createElement('p'); caption.className = 'setting-caption'; caption.textContent = '同じ書式を使う箇所が一緒に変わります。個別の変更は優先して残ります。'; details.append(caption);
  const controls = document.createElement('div'); details.append(controls); parent.append(details);
  let kind: keyof StyleCatalog = 'paragraphs', selected = 'body';
  const kinds = [['paragraphs', '本文・段落'], ['headings', '見出し'], ['characters', '文字'], ['pages', '版面'], ['sections', '章']] as const;
  const select = (label: string, id: string, value: string, options: readonly (readonly [string,string])[], changed: (value: string) => void) => {
    const row = document.createElement('label'); row.className = 'select-label'; row.textContent = label; const el = document.createElement('select'); el.id = id;
    options.forEach(([v,t])=>el.append(new Option(t,v))); el.value=value; el.addEventListener('change',()=>changed(el.value)); row.append(el); controls.append(row);
  };
  const entry = () => host.book().styles[kind]!.find(s=>s.id===selected)!;
  const update = (patch: object) => { const b=host.book(), styles=structuredClone(b.styles); Object.assign(styles[kind]!.find(s=>s.id===selected)!,patch); host.change({...b,styles}); render(); };
  function render(): void {
    controls.replaceChildren(); const b=host.book(), list=b.styles[kind]!;
    if(!list.some(s=>s.id===selected))selected=list[0]!.id;
    select('種類','style-family',kind,kinds,v=>{kind=v as keyof StyleCatalog;selected=host.book().styles[kind]![0]!.id;render();});
    select('編集するスタイル','style-entry',selected,list.map(s=>[s.id,s.name]),v=>{selected=v;render();});
    const e=entry(); select('継承元','style-base',e.basedOn??'',[['','継承しない'],...list.filter(s=>s.id!==selected).map(s=>[s.id,s.name] as const)],v=>{update({basedOn:v||undefined});render();});
    if(kind==='paragraphs'||kind==='headings')select('文字のスタイル','style-character',e.characterStyleId??'',[['','継承元に従う'],...b.styles.characters.map(s=>[s.id,s.name] as const)],v=>{update({characterStyleId:v||undefined});render();});
    const fields=document.createElement('div'); controls.append(fields);
    if(kind==='sections') {
      const props=()=>entry().properties as SectionProperties;
      select('版面のスタイル','style-section-page',props().pageStyleId??'',[['','本全体に従う'],...b.styles.pages!.map(s=>[s.id,s.name] as const)],v=>{const p={...props()};if(v)p.pageStyleId=v;else delete p.pageStyleId;update({properties:p});});
      select('本文のスタイル','style-section-body',props().paragraphStyleId??'',[['','本全体に従う'],...b.styles.paragraphs.map(s=>[s.id,s.name] as const)],v=>{const p={...props()};if(v)p.paragraphStyleId=v;else delete p.paragraphStyleId;update({properties:p});});
      select('開始位置','style-section-start',props().start??'',[['','本全体に従う'],['continuous','本文の続き'],['next','次ページ'],['left','左ページ'],['right','右ページ']],v=>{const p={...props()};if(v)p.start=v as NonNullable<SectionProperties['start']>;else delete p.start;update({properties:p});});
      styleFields<PageProperties>(fields,'style-section','page',()=>props().page??{},page=>update({properties:{...props(),page}}));
    } else styleFields(fields,'style',kind==='characters'?'character':kind==='pages'?'page':'paragraph',()=>entry().properties as PageProperties,p=>update({properties:p}),kind==='characters'&&selected==='text'?['fontFamily']:[]);
    const note=document.createElement('p'); note.className='setting-caption';
    const effective=inheritedStyle(list as {id:string;name:string;properties:object;basedOn?:string}[],selected).properties;
    note.textContent=`継承後の設定 ${Object.keys(effective).length} 件。空欄は継承元・本全体に従います。`;controls.append(note);
    const duplicate=document.createElement('button'); duplicate.type='button'; duplicate.className='text-button'; duplicate.id='duplicate-style'; duplicate.textContent='このスタイルから作る';
    duplicate.addEventListener('click',()=>{const book=host.book(),styles=structuredClone(book.styles),id=`style-${book.document.nextId}`;styles[kind]!.push({id,name:`${entry().name.slice(0,80)}の派生`,basedOn:selected,properties:{}});host.change({...book,styles,document:{...book.document,nextId:book.document.nextId+1}});selected=id;render();}); controls.append(duplicate);
    const reset=document.createElement('button');reset.type='button';reset.className='text-button';reset.id='reset-shared-style';reset.textContent='このスタイルの変更をリセット';reset.addEventListener('click',()=>{const standard=defaultCatalog()[kind]!.find(s=>s.id===selected);update(standard?{properties:standard.properties,basedOn:standard.basedOn,...(kind==='paragraphs'||kind==='headings'?{characterStyleId:standard.characterStyleId}:{})}:{properties:{}});});controls.append(reset);
  }
  details.addEventListener('toggle',()=>{if(details.open)render();});
}
