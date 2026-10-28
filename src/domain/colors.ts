export const PAPER_COLORS = [['white','白'],['warm','生成り'],['#fbf0f2','桜'],['#edf3fa','藍白'],['#edf3ef','若草'],['#eee5d6','砂'],['#24324b','夜紺'],['#202326','墨']] as const;
export const TEXT_COLORS = [['#282b28','墨'],['#000000','黒'],['#555b61','灰'],['#483e32','茶'],['#263d54','藍'],['#2f4438','深緑'],['#f4f0e7','生成り'],['#ffffff','白']] as const;
export const PALETTES = [
  { id:'white',name:'白',paper:'white',ink:'#282b28' },
  { id:'warm',name:'生成り',paper:'warm',ink:'#282b28' },
  { id:'sakura',name:'桜',paper:'#fbf0f2',ink:'#4b333b' },
  { id:'blue',name:'藍白',paper:'#edf3fa',ink:'#263d54' },
  { id:'green',name:'若草',paper:'#edf3ef',ink:'#2f4438' },
  { id:'sand',name:'砂',paper:'#eee5d6',ink:'#483e32' },
  { id:'navy',name:'夜紺',paper:'#24324b',ink:'#f4f0e7' },
  { id:'ink',name:'墨',paper:'#202326',ink:'#f4f0e7' },
] as const;
export function hexColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[a-f0-9]{6}$/iu.test(value)) throw new Error('色はRGBの6桁の値で指定してください。');
  return value.toLowerCase();
}
export function paperHex(value: string = 'white'): string { return value === 'white' ? '#ffffff' : value === 'warm' ? '#fffefa' : hexColor(value); }
export function textHex(value: string = '#282b28'): string { return hexColor(value); }
export function contrastRatio(a: string, b: string): number {
  const light = (color: string) => {
    const rgb = [1,3,5].map(at => parseInt(hexColor(color).slice(at,at+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722;
  };
  const x=light(a),y=light(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function readableInk(paper: string): string { return contrastRatio(paper,'#282b28') >= contrastRatio(paper,'#ffffff') ? '#282b28' : '#ffffff'; }
