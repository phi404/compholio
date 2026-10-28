import type { BookStyle, BookPage, FlowPage, FlowLine, Inline, RenderedPages, Diagnostic } from '../domain/contracts.js';
import { advance, verticalAdvance, geometry, graphemes, pageMargins, validateStyle } from '../domain/style.js';
import type { PaginationBlock } from './paginator.js';
import { matchesPageStart, pageSide } from '../domain/page-order.js';
import { imagePrintInfo } from '../domain/image-print.js';
import { wrapRuns as wrap } from './line-breaks.js';

type Atom = Inline & { advanceEm: number; sizeMm: number; tcy?: boolean; displayText?: string; textFrom: number; textTo: number };
const textOf = (r: Inline) => r.kind === 'ruby' ? r.base : r.text;
function atoms(runs: readonly Inline[], style: BookStyle, scale: number, capacity: number, warn: (code: string) => void): Atom[] {
  const out: Atom[] = [], font = style.fontPt * 25.4 / 72; let textOffset = 0;
  for (const run of runs) {
    const family=run.fontFamily??style.fontFamily,width=(s:string)=>graphemes(s).reduce((sum,g)=>sum+advance(g,family),0);
    const size = run.fontPt ? run.fontPt * 25.4 / 72 : font * scale, factor = size / font, space = run.letterSpacingEm ?? 0;
    if (run.kind === 'ruby') {
      const baseWidth=(s:string)=>graphemes(s).reduce((sum,g)=>sum+(style.writingMode==='vertical-rl'?verticalAdvance(g,run.orientation,family):advance(g,family)),0);
      const base = graphemes(run.base), reading = graphemes(run.reading); let start = 0;
      while (start < base.length) {
        let end = start + 1;
        const part = (to: number) => ({base:base.slice(start,to).join(''),reading:reading.slice(Math.floor(start*reading.length/base.length),Math.floor(to*reading.length/base.length)).join('')});
        while (end < base.length) { const next = part(end+1); if (Math.max(baseWidth(next.base),width(next.reading)*.5)*factor>capacity) break; end++; }
        if (end < base.length) warn('ruby-split'); const piece=part(end); out.push({...run,...piece,textFrom:textOffset,textTo:textOffset+piece.base.length,orientation:/^[0-9A-Za-z]+$/u.test(piece.base)?run.orientation??'mixed':'mixed',sizeMm:size,advanceEm:(Math.max(baseWidth(piece.base),width(piece.reading)*.5)+space)*factor}); textOffset+=piece.base.length; start=end;
      }
      continue;
    }
    const chunks = style.writingMode === 'vertical-rl' ? run.text.match(/[0-9]+|[A-Za-z]+|[^0-9A-Za-z]+/gu) ?? [] : [run.text];
    for (const chunk of chunks) {
      const numeric = /^[0-9]+$/u.test(chunk), mode=run.numbers ?? 'auto';
      const tcy=style.writingMode==='vertical-rl' && numeric && (mode==='tcy'||mode==='auto'&&chunk.length===2&&(!run.orientation||run.orientation==='mixed'));
      // These overrides concern Latin/numerals; CJK punctuation and ruby retain vertical forms.
      const orientation = numeric && mode==='kanji' || !/^[0-9A-Za-z]+$/u.test(chunk) ? 'mixed' : numeric && ['upright','sideways'].includes(mode) ? mode as 'upright'|'sideways' : run.orientation ?? (numeric&&mode==='auto'&&chunk.length===1?'upright':'mixed');
      const sideways = style.writingMode==='vertical-rl' && orientation!=='upright' && /^[0-9A-Za-z]+$/u.test(chunk) && !tcy && mode!=='kanji';
      const units=tcy||sideways&&width(chunk)*factor<=capacity?[chunk]:graphemes(chunk);
      for (const glyph of units) {
        const displayText=numeric&&mode==='kanji' ? glyph.replace(/[0-9]/gu,n=>'〇一二三四五六七八九'[Number(n)]!) : undefined;
        const em=tcy?1:style.writingMode==='vertical-rl'&&(orientation==='upright'||displayText)?graphemes(displayText??glyph).length:width(glyph);
        out.push({...run,text:glyph,textFrom:textOffset,textTo:textOffset+glyph.length,orientation:sideways?'sideways':orientation,sizeMm:size,advanceEm:(em+space)*factor,...(tcy?{tcy:true}:{}),...(displayText?{displayText}: {})});textOffset+=glyph.length;
      }
    }
  }
  return out;
}
/** Variable metrics and semantic page transitions; all positions remain generated results. */
export function paginateAdvanced(blocks: readonly PaginationBlock[], baseStyle: BookStyle): RenderedPages {
  const pages: BookPage[]=[],diagnostics: Diagnostic[]=[];let style=validateStyle(baseStyle),grid=geometry(style),band=0,cursor=0,heading='',afterSpecial=false;
  let page:FlowPage={kind:'flow',number:1,lines:[],style};
  const occupied=()=>cursor>0||band>0||page.lines.length>0||(page.elements?.length??0)>0;
  const fresh=()=>{band=0;cursor=0;page={kind:'flow',number:pages.length+1,lines:[],style,...(heading?{heading}: {})};};
  const next=()=>{pages.push(page);fresh();};
  const blockLimit=()=>Math.min(grid.blockMm,grid.lines*grid.lineMm);
  const nextBand=()=>{if(band+1<style.columns){band++;cursor=0;}else next();};
  const room=(pitch:number)=>{if(cursor+pitch>blockLimit()+.00001)nextBand();};
  const warn=(blockId:string,code:string)=>{if(!diagnostics.some(d=>d.blockId===blockId&&d.code===code))diagnostics.push({blockId,code,message:code==='ruby-split'?'長いルビを、親文字と読みを保持して分割しました。':code==='paragraph-fragment-relaxed'?'この版面では段落の最少行数を満たせません。文字を保持して自動で分割しました。':'版面内で解決できない文字の並びがあります。原文は保持しています。'});};
  for(let at=0;at<blocks.length;at++){
    const b=blocks[at]!,target=b.layoutStyle??baseStyle;
    if(JSON.stringify(target)!==JSON.stringify(style)){if(occupied())next();style=validateStyle(target);grid=geometry(style);page={...page,style};}
    if(b.sectionId) page.sectionId=b.sectionId;
    if(b.kind==='specialPage'){
      const info=b.page.imageInfo;
      if(info?.placement==='flow'){
        const vertical=style.writingMode==='vertical-rl',span=Math.min(blockLimit(),Math.max(grid.lineMm*3,grid.blockMm*.4));room(span); const margins=pageMargins(style,page.number);
        const element=b.page.elements[0]; if(element){const x=vertical?style.page.widthMm-margins.right-cursor-span:margins.left+band*(grid.inlineMm+grid.gap),y=vertical?style.margins.topMm+band*(grid.inlineMm+grid.gap):style.margins.topMm+cursor;
          const image={...element,xMm:x,yMm:y,widthMm:vertical?span:grid.inlineMm,heightMm:vertical?grid.inlineMm:span,blockId:b.id,imagePlacement:'flow' as const};const print=imagePrintInfo({dataUrl:'',width:info.sourcePixels[0],height:info.sourcePixels[1]},image.widthMm,image.heightMm,image.fit??'contain','flow');page={...page,elements:[...(page.elements??[]),image],imageInfo:[...(page.imageInfo??[]),print]};cursor+=span;}
        afterSpecial=false;continue;
      }
      if(occupied())next();
      if(info?.placement==='spread'&&page.number%2===1)next();
      const count=info?.placement==='spread'?2:1;
      for(let side=0;side<count;side++)pages.push({...b.page,number:pages.length+1,style,...(b.sectionId?{sectionId:b.sectionId}:{}),elements:count===2?b.page.elements.map(e=>({...e,xMm:pageSide(pages.length+1,style.binding)==='right'?-style.page.widthMm:0,widthMm:style.page.widthMm*2})):b.page.elements});
      fresh();afterSpecial=true;continue;
    }
    if(b.kind==='pageBreak'){
      if(occupied()||b.start==='next'&&!afterSpecial)next();afterSpecial=false;
      if(!matchesPageStart(b.start,page.number,style))next();
      if(b.start!=='next'&&style.pageLayout==='uniform')diagnostics.push({code:'uniform-page-start',blockId:b.id,message:'左右共通のページでは左右開始を通常の改ページとして扱います。'});
      continue;
    }
    afterSpecial=false;
    const scale=b.kind==='heading'?Math.max(1,Math.min(1.15,(style.lineHeight-.04)/1.51)):1,font=grid.fontMm;
    const rawIndent=b.indentEm??(b.kind==='paragraph'&&style.paragraphIndent&&!/^[\s　「『（【〈《]/u.test(b.inlines.map(textOf).join(''))?1:0),inset=Math.min(b.insetEm??0,grid.chars-1),endInset=Math.min(b.endInsetEm??0,grid.chars-inset-1);
    if(inset!==(b.insetEm??0)||endInset!==(b.endInsetEm??0))warn(b.id,'indent-clamped');
    const capacity=Math.max(1,grid.chars-inset-endInset),indent=Math.min(rawIndent,Math.max(0,capacity-1));if(indent!==rawIndent)warn(b.id,'indent-clamped');
    const list=atoms(b.inlines,style,scale,capacity,code=>warn(b.id,code));const lines=wrap(list,capacity,indent,()=>warn(b.id,'kinsoku-unresolved'));
    if(!lines.length){if(at!==blocks.length-1){room(grid.lineMm);cursor+=grid.lineMm;}continue;}
    const pitch=Math.max(font*(b.lineHeight??style.lineHeight),...lines.map(l=>Math.max(...l.runs.map(r=>r.sizeMm))*1.55)),before=(b.beforeEm??0)*font,after=(b.afterEm??(b.kind==='heading'?style.lineHeight:0))*font;
    const nextBlock=blocks[at+1];let following=grid.lineMm;
    if(nextBlock&&(nextBlock.kind==='paragraph'||nextBlock.kind==='heading')){
      const nextScale=nextBlock.kind==='heading'?Math.max(1,Math.min(1.15,(style.lineHeight-.04)/1.51)):1;
      following=Math.max(font*(nextBlock.lineHeight??style.lineHeight),...nextBlock.inlines.map(r=>(r.fontPt?r.fontPt*25.4/72:font*nextScale)*1.55))+(nextBlock.beforeEm??0)*font;
    }
    const keep=(lines.length*pitch+before+after+following);if(b.keepWithNext&&keep<=blockLimit()&&cursor+keep>blockLimit()) {if(band+1<style.columns){band++;cursor=0;}else next();}
    room(before+pitch);cursor+=before;
    if(b.kind==='heading'){heading=b.inlines.map(textOf).join('');page={...page,heading};}
    let fragmentEnd = 0;
    for(const [lineIndex,l] of lines.entries()){
      room(pitch);
      if (lineIndex === fragmentEnd) {
        const remaining = lines.length - lineIndex, full = Math.max(1, Math.floor((blockLimit() + .00001) / pitch));
        let available = Math.max(1, Math.floor((blockLimit() - cursor + .00001) / pitch));
        const orphans = b.orphans ?? 1, widows = b.widows ?? 1;
        if (remaining > available && cursor > .00001 && (available < orphans || remaining - available < widows && remaining <= full)) {
          nextBand(); available = full;
        }
        let count = Math.min(remaining, available);
        if (remaining > available) {
          count = Math.min(available, remaining - widows);
          if (count < orphans) { count = Math.min(remaining, available); warn(b.id, 'paragraph-fragment-relaxed'); }
        }
        fragmentEnd = lineIndex + count;
      }
      const margins=pageMargins(style,page.number),used=l.runs.reduce((sum,r)=>sum+r.advanceEm,0)+l.indentEm;
      const shift=Math.max(0,(capacity-used)*font)*(b.alignment==='center'?.5:b.alignment==='end'?1:0),vertical=style.writingMode==='vertical-rl';
      const x=vertical?style.page.widthMm-margins.right-cursor-pitch/2:margins.left+band*(grid.inlineMm+grid.gap)+(inset+l.indentEm)*font+shift;
      const y=vertical?style.margins.topMm+band*(grid.inlineMm+grid.gap)+(inset+l.indentEm)*font+shift:style.margins.topMm+cursor+pitch*.75;
      const line:FlowLine={blockId:b.id,indentEm:l.indentEm,...(b.alignment?{alignment:b.alignment}:{}),heading:b.kind==='heading',fontScale:scale,column:Math.round(cursor/grid.lineMm),band,xMm:x,yMm:y,lengthMm:capacity*font,runs:l.runs};page={...page,lines:[...page.lines,line]};cursor+=pitch;
      if (lineIndex + 1 === fragmentEnd && fragmentEnd < lines.length) nextBand();
    }
    cursor=Math.min(grid.blockMm,cursor+after);
  }
  if(!pages.length||occupied()||blocks.at(-1)?.kind==='pageBreak'||pages.at(-1)?.kind==='flow')pages.push(page);
  return {pages,diagnostics};
}
