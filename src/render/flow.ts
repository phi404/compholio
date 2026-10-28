import { fontData } from './font-data.js';
import { isDashText } from '../domain/text-symbols.js';
import type { BookStyle, FlowLine } from '../domain/contracts.js';
import { advance, verticalAdvance, graphemes } from '../domain/style.js';
import { verticalText, combinedText } from './text.js';
import { emphasisMarks } from './emphasis.js';
const n=(v:number)=>Number(v.toFixed(5));
export function renderFlowLine(line: FlowLine,style: BookStyle,escape:(s:string)=>string):string {
  const vertical=style.writingMode==='vertical-rl',out:string[]=[],font=style.fontPt*25.4/72;let x=line.xMm!,y=line.yMm!;
  let family=style.fontFamily;
  const width=(s:string)=>graphemes(s).reduce((sum,g)=>sum+advance(g,family),0);
  const text=(value:string,px:number,py:number,size:number,attrs='',orientation='mixed')=>vertical?verticalText(value,px,py,size,escape,attrs,orientation,family):'<text '+attrs+' x="'+n(px)+'" y="'+n(py)+'" font-size="'+n(size)+'" writing-mode="horizontal-tb">'+escape(value)+'</text>';
  const marks=(run:FlowLine['runs'][number],value:string,px:number,py:number,size:number)=>out.push(emphasisMarks(run,value,px,py,size,vertical,family));
  for(let i=0;i<line.runs.length;i++){
    const run=line.runs[i]!; family=run.fontFamily??style.fontFamily; const {origin:FONT_VERTICAL_ORIGIN,units:FONT_UNITS_PER_EM}=fontData(family);
    const size=run.sizeMm??font,span=(run.advanceEm??1)*font,value=run.displayText??(run.kind==='text'?run.text:run.base),weight=run.fontWeight===700?' font-weight="700"':'';
    const range=(from=run.textFrom,to=run.textTo)=>from!==undefined&&to!==undefined?` data-text-from="${from}" data-text-to="${to}"`:'';
    const attrs=`font-family="'${escape(family)}','Book Mincho',serif" data-body="${run.kind==='ruby'?'ruby-base':'text'}"${weight}${line.heading?' data-heading="true"':''}${run.orientation?` data-orientation="${run.orientation}"`:''}${run.displayText?` data-source-text="${escape(run.kind==='text'?run.text:run.base)}"`:''}`;
    if(run.kind==='text'&&isDashText(run.text)){
      let length=span;while(line.runs[i+1]?.kind==='text'&&isDashText((line.runs[i+1] as {text:string}).text)&&line.runs[i+1]!.emphasis===run.emphasis&&line.runs[i+1]!.sizeMm===run.sizeMm&&line.runs[i+1]!.fontWeight===run.fontWeight)length+=(line.runs[++i]!.advanceEm??1)*font;
      const dashY=vertical?y:y-size*(FONT_VERTICAL_ORIGIN/FONT_UNITS_PER_EM-.5);
      out.push(`<line data-dash="continuous"${range(run.textFrom,line.runs[i]!.textTo)} x1="${n(x)}" y1="${n(dashY)}" x2="${n(vertical?x:x+length)}" y2="${n(vertical?y+length:dashY)}" stroke="currentColor" stroke-width="${n(size*(run.fontWeight===700?.06:.045))}"/>`);marks(run,'―'.repeat(Math.round(length/size)),x,y,size);if(vertical)y+=length;else x+=length;continue;
    }
    if(run.kind==='ruby'){
      const baseWidth=(s:string)=>graphemes(s).reduce((sum,g)=>sum+(vertical?verticalAdvance(g,run.orientation,family):advance(g,family)),0),baseSpan=baseWidth(run.base)*size,baseOffset=Math.max(0,(span-baseSpan)/2);let offset=0;
      let sourceOffset=run.textFrom??0;for(const g of graphemes(run.base)){out.push(text(g,vertical?x:x+baseOffset+offset,vertical?y+baseOffset+offset:y,size,attrs+range(sourceOffset,sourceOffset+g.length),run.orientation));offset+=(vertical?verticalAdvance(g,run.orientation,family):advance(g,family))*size;sourceOffset+=g.length;}
      const readingSize=size*Math.min(.5,span/Math.max(size,width(run.reading)*size)),readingSpan=width(run.reading)*readingSize;offset=Math.max(0,(span-readingSpan)/2);
      for(const g of graphemes(run.reading)){out.push(text(g,vertical?x+size*.76:x+offset,vertical?y+offset:y-size*.76,readingSize,`font-family="'${escape(family)}','Book Mincho',serif" data-ruby="reading"`+range()));offset+=advance(g,family)*readingSize;}
      marks(run,run.base,vertical?x:x+baseOffset,vertical?y+baseOffset:y,size);
    }else if(run.tcy&&vertical){out.push(combinedText(value,x,y,size,escape,attrs+range(),width(value)>1.1,family));marks(run,value,x,y,size);}
    else if(vertical&&run.orientation==='sideways'&&/^[0-9A-Za-z]+$/u.test(value)){out.push(verticalText(value,x,y,size,escape,attrs+range(),'sideways',family));marks(run,value,x,y,size);}
    else {out.push(text(value,x,y,size,attrs+range(),run.orientation));marks(run,value,x,y,size);}
    if(vertical)y+=span;else x+=span;
  }
  return `<g data-block-id="${escape(line.blockId)}">${out.join('')}</g>`;
}
