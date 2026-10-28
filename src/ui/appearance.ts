import type { BookStyle } from '../domain/contracts.js';
import { FONT_CATALOG } from '../domain/fonts.js';
import { PALETTES, PAPER_COLORS, TEXT_COLORS, paperHex, textHex, contrastRatio, readableInk } from '../domain/colors.js';
import { el } from './dom.js';

export function appearanceEditor(host:{getStyle():BookStyle;change(style:BookStyle):void}) {
  const font=el<HTMLSelectElement>('book-font'),paper=el<HTMLSelectElement>('paper-color'),ink=el<HTMLSelectElement>('text-color');
  for(const entry of FONT_CATALOG)font.append(new Option(entry.label,entry.family));
  const fill=(control:HTMLSelectElement,entries:readonly (readonly [string,string])[])=>{for(const [value,name]of entries)control.append(new Option(name,value));};
  fill(paper,PAPER_COLORS);fill(ink,TEXT_COLORS);
  font.addEventListener('change',()=>host.change({...host.getStyle(),fontFamily:font.value}));
  paper.addEventListener('change',()=>host.change({...host.getStyle(),paperColor:paper.value as NonNullable<BookStyle['paperColor']>}));
  ink.addEventListener('change',()=>host.change({...host.getStyle(),textColor:ink.value}));
  for(const [id,key]of [['paper-rgb','paperColor'],['text-rgb','textColor']] as const)el<HTMLInputElement>(id).addEventListener('change',event=>host.change({...host.getStyle(),[key]:(event.currentTarget as HTMLInputElement).value}));
  for(const palette of PALETTES){
    const button=document.createElement('button');button.type='button';button.dataset.palette=palette.id;button.setAttribute('aria-label',palette.name);button.style.setProperty('--paper',paperHex(palette.paper));button.style.setProperty('--ink',palette.ink);
    const sample=document.createElement('span');sample.className='palette-sample';sample.textContent='文';sample.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=palette.name;button.append(sample,label);
    button.addEventListener('click',()=>{host.change({...host.getStyle(),paperColor:palette.paper,textColor:palette.ink});el('palette-popover').hidePopover();el('palette-button').focus();});el('palette-options').append(button);
  }
  el('fix-contrast').addEventListener('click',()=>host.change({...host.getStyle(),textColor:readableInk(paperHex(host.getStyle().paperColor))}));
  const value=(control:HTMLSelectElement,color:string)=>{control.querySelector('option[data-custom]')?.remove();if(![...control.options].some(o=>o.value===color)){const option=new Option('カスタム '+color,color);option.dataset.custom='true';control.append(option);}control.value=color;};
  function sync():void {
    const style=host.getStyle(),background=paperHex(style.paperColor),foreground=textHex(style.textColor),preset=PALETTES.find(p=>paperHex(p.paper)===background&&p.ink===foreground);
    font.value=style.fontFamily;value(paper,style.paperColor??'white');value(ink,foreground);el<HTMLInputElement>('paper-rgb').value=background;el<HTMLInputElement>('text-rgb').value=foreground;
    el('palette-label').textContent=preset?.name??'カスタム';el('palette-preview').style.backgroundColor=background;el('palette-preview').style.color=foreground;
    el('contrast-warning').hidden=contrastRatio(background,foreground)>=4.5;
    for(const button of el('palette-options').querySelectorAll<HTMLButtonElement>('button'))button.setAttribute('aria-pressed',String(button.dataset.palette===preset?.id));
  }
  return {sync};
}
