import { dashAdvance, isDashText } from '../domain/text-symbols.js';
import { advance, verticalAdvance, graphemes } from '../domain/style.js';
import { UPRIGHT_RANGES } from './vertical-font.js';
import { fontData } from './font-data.js';
const n=(v:number)=>Number(v.toFixed(5));
const upright=(g:string)=>{const cp=g.codePointAt(0)!;return UPRIGHT_RANGES.some(([from,to])=>cp>=from&&cp<=to);};
/** Use the font's vertical origins; SVG vertical baselines differ between engines. */
export function verticalText(value:string,x:number,y:number,size:number,escape:(s:string)=>string,attrs='',orientation='mixed',family='Book Mincho'):string {
  const {units:FONT_UNITS_PER_EM,origin:FONT_VERTICAL_ORIGIN,glyphs:VERTICAL_GLYPHS,origins:VERTICAL_ORIGINS}=fontData(family);
  const sideways=(text:string,px:number,py:number)=>
    '<text '+attrs+' x="'+n(px)+'" y="'+n(py)+'" font-size="'+n(size)+'" writing-mode="horizontal-tb" dominant-baseline="alphabetic" transform="rotate(90 '+n(px)+' '+n(py)+') translate(0 '+n(size*(FONT_VERTICAL_ORIGIN/FONT_UNITS_PER_EM-.5))+')">'+escape(text)+'</text>';
  if(/^[0-9A-Za-z]+$/u.test(value)&&orientation!=='upright')return sideways(value,x,y);
  let offset=0,skip=0;const clusters=graphemes(value);
  return clusters.map((g,index)=>{
    if(skip){skip--;return '';}
    const py=y+offset*size;offset+=verticalAdvance(g,orientation,family);
    if(isDashText(g)){let length=dashAdvance(g)!;while(isDashText(clusters[index+skip+1]??'')){length+=dashAdvance(clusters[index+(++skip)]!)!;}offset+=length-advance(g,family);
      return '<line '+attrs+' data-dash="continuous" x1="'+n(x)+'" y1="'+n(py)+'" x2="'+n(x)+'" y2="'+n(py+length*size)+'" stroke="currentColor" stroke-width="'+n(size*(/font-weight="700"/u.test(attrs)?.06:.045))+'"/>';
    }
    const glyph=VERTICAL_GLYPHS[g];
    if(glyph){const [path,origin]=glyph,scale=size/FONT_UNITS_PER_EM,bold=/font-weight="700"/u.test(attrs);
      return '<g '+attrs+' data-vertical-glyph="'+escape(g)+'"><title>'+escape(g)+'</title><rect x="'+n(x-size/2)+'" y="'+n(py)+'" width="'+n(size)+'" height="'+n(size)+'" fill="transparent"/><path d="'+path+'" transform="translate('+n(x-size/2)+' '+n(py+origin*scale)+') scale('+scale+' '+(-scale)+')"'+(bold?' stroke="currentColor" stroke-width="20" stroke-linejoin="round"':'')+'/></g>';
    }
    if(orientation!=='upright'&&!upright(g))return sideways(g,x,py);
    const origin=VERTICAL_ORIGINS[g]??FONT_VERTICAL_ORIGIN;
    return '<text '+attrs+' x="'+n(x)+'" y="'+n(py)+'" font-size="'+n(size)+'" writing-mode="horizontal-tb" text-anchor="middle" dominant-baseline="alphabetic" transform="translate(0 '+n(size*origin/FONT_UNITS_PER_EM)+')">'+escape(g)+'</text>';
  }).join('');
}
/** Numerals sit in one vertical cell, using the same explicit baseline. */
export function combinedText(value:string,x:number,y:number,size:number,escape:(s:string)=>string,attrs='',fit=false,family='Book Mincho'):string {
  const {units:FONT_UNITS_PER_EM,origin:FONT_VERTICAL_ORIGIN}=fontData(family);
  const font=size*.9,baseline=y+size*.5+font*(FONT_VERTICAL_ORIGIN/FONT_UNITS_PER_EM-.5);
  return '<text '+attrs+' data-tcy="true" x="'+n(x)+'" y="'+n(baseline)+'" font-size="'+n(font)+'" text-anchor="middle" dominant-baseline="alphabetic"'+(fit?' textLength="'+n(size)+'" lengthAdjust="spacingAndGlyphs"':'')+'>'+escape(value)+'</text>';
}
