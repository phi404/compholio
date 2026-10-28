import type { Inline } from '../domain/contracts.js';
import { advance, verticalAdvance, graphemes } from '../domain/style.js';
const n=(v:number)=>Number(v.toFixed(5));
export function emphasisMarks(run:Inline & {tcy?:boolean},text:string,x:number,y:number,size:number,vertical=true,family='Book Mincho'):string {
  if(!run.emphasis||run.emphasis==='none')return '';let offset=0;
  return (vertical&&run.tcy?[text]:graphemes(text)).map(g=>{
    const a=vertical?(run.tcy?1:verticalAdvance(g,run.orientation,family)):advance(g,family),center=(offset+a/2)*size;offset+=a;
    if(/^[\p{White_Space}\p{Punctuation}]/u.test(g))return '';
    const cx=vertical?x+(run.kind==='ruby'?-.72:.7)*size:x+center,cy=vertical?y+center:y-(run.kind==='ruby'?1.22:.72)*size;
    if(run.emphasis==='dot'||run.emphasis==='circle')return '<circle data-emphasis="'+run.emphasis+'" cx="'+n(cx)+'" cy="'+n(cy)+'" r="'+n(size*.075)+'"'+(run.emphasis==='circle'?' fill="none" stroke="currentColor" stroke-width="'+n(size*.035)+'"':'')+'/>';
    if(run.emphasis==='triangle')return '<path data-emphasis="triangle" d="M'+n(cx)+' '+n(cy-size*.1)+'l'+n(size*.09)+' '+n(size*.16)+'h'+n(-size*.18)+'Z"/>';
    return '<ellipse data-emphasis="sesame" cx="'+n(cx)+'" cy="'+n(cy)+'" rx="'+n(size*.055)+'" ry="'+n(size*.12)+'" transform="rotate(28 '+n(cx)+' '+n(cy)+')"/>';
  }).join('');
}
