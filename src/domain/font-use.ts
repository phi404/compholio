import type { BookPage, BookStyle } from './contracts.js';
import type { Publication } from './model.js';
import { FONT_COVERAGE } from './font-advances.js';

function needsFallback(family: string, text: string): boolean {
  const ranges=FONT_COVERAGE[family];
  if(!ranges)return false;
  const checked=new Set<number>();
  for(const char of text){
    const cp=char.codePointAt(0)!;if(cp<=32||checked.has(cp))continue;checked.add(cp);
    let low=0,high=ranges.length-1,found=false;
    while(low<=high){const mid=(low+high)>>>1,[from,to]=ranges[mid]!;if(cp<from)high=mid-1;else if(cp>to)low=mid+1;else{found=true;break;}}
    if(!found)return true;
  }
  return false;
}
export function pageFonts(page: BookPage, base: BookStyle): string[] {
  const style=page.style??base, fonts=new Set<string>();
  const add=(family:string|undefined,text:string)=>{const name=family??style.fontFamily;fonts.add(name);if(needsFallback(name,text))fonts.add('Book Mincho');};
  for(const line of page.lines)for(const run of line.runs)add(run.fontFamily,run.kind==='ruby'?run.base+run.reading:run.text);
  for(const e of page.elements??[])if(e.kind==='text')add(e.fontFamily,e.text??'');
  if(style.folio?.enabled)add(style.folio.fontFamily,page.folioLabel??String(page.number));
  for(const h of style.runningHeads??[])add(h.fontFamily,h.text);
  for(const h of page.runningElements??[])add(h.fontFamily,h.text);
  if(!fonts.size)fonts.add(style.fontFamily);
  return [...fonts];
}
/** Include fonts referenced by editable styles too, so the bundle remains editable. */
export function bookFonts(book: Publication): string[] {
  const fonts=new Set<string>([book.style.fontFamily]);
  const visit=(value:unknown):void=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(key==='fontFamily'&&typeof child==='string')fonts.add(child);else if(typeof child==='object')visit(child);}};
  visit({style:book.style,document:book.document,styles:book.styles,overrides:book.overrides,running:book.runningElements,special:book.specialPages});
  const text=book.source+book.document.title+book.document.author+JSON.stringify(book.specialPages)+JSON.stringify(book.runningElements);
  for(const family of fonts)if(needsFallback(family,text))fonts.add('Book Mincho');
  return [...fonts];
}
