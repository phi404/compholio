import type { BookPage, BookStyle } from '../domain/contracts.js';
import { pageFonts } from '../domain/font-use.js';
import { fontResource } from './resources.js';

const loaded=new Map<string,Promise<void>>(), data=new Map<string,Promise<string>>();
function load(family:string):Promise<void> {
  let promise=loaded.get(family);
  if(!promise){fontResource(family);promise=document.fonts.load(`16px '${family}'`).then(faces=>{if(!faces.length)throw new Error('書体を読み込めません。');}).catch(error=>{loaded.delete(family);throw error;});loaded.set(family,promise);}
  return promise;
}
export async function loadPageFonts(pages:readonly BookPage[],style:BookStyle):Promise<void> {
  await Promise.all([...new Set(pages.flatMap(page=>pageFonts(page,style)))].map(load));
}
function dataURL(family:string):Promise<string> {
  let promise=data.get(family);
  if(!promise){const resource=fontResource(family);promise=fetch(resource.url).then(async response=>{
    if(!response.ok)throw new Error('書き出し用の書体を読み込めません。');
    const blob=new Blob([await response.arrayBuffer()],{type:resource.format==='woff2'?'font/woff2':resource.format==='truetype'?'font/ttf':'font/otf'});
    return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('書体を読み込めません。'));reader.readAsDataURL(blob);});
  }).catch(error=>{data.delete(family);throw error;});data.set(family,promise);}
  return promise;
}
export async function pageFontData(page:BookPage,style:BookStyle):Promise<Readonly<Record<string,string>>> {
  return Object.fromEntries(await Promise.all(pageFonts(page,style).map(async family=>[family,await dataURL(family)])));
}
