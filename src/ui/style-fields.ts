import { iconChoices, alignmentOptions, weightOptions } from './choices.js';
import type { CharacterProperties, ParagraphProperties } from '../domain/contracts.js';
import type { PageProperties } from '../domain/model.js';
import { FONT_CATALOG } from '../domain/fonts.js';

type Values = CharacterProperties | ParagraphProperties | PageProperties;
export function styleFields<P extends Values>(parent: HTMLElement, prefix: string, kind: 'character' | 'paragraph' | 'page', current: () => P, edit: (value: P, key: string) => void, omit: string[] = []): void {
  const add = (key: string, label: string, options?: readonly (readonly [string, string])[], min = 0, max = 20, step = .1) => {
    if (omit.includes(key)) return;
    if (key === 'alignment' || key === 'fontWeight') {
      iconChoices(parent, `${prefix}-${key}`, label, key === 'alignment' ? alignmentOptions : weightOptions, (current() as Record<string, unknown>)[key], value => {
        const props = { ...current() } as Record<string, unknown>; if (!value) delete props[key]; else props[key] = key === 'fontWeight' ? Number(value) : value; edit(props as P, key);
      });
      return;
    }
    const row = document.createElement('label'); row.className = 'select-label'; row.textContent = label;
    const control = options ? document.createElement('select') : document.createElement('input'); control.id = `${prefix}-${key}`;
    if (control instanceof HTMLSelectElement) { control.append(new Option('基本の書式に従う', '')); for (const [value, text] of options!) control.append(new Option(text, value)); }
    else { control.type = 'number'; control.min = String(min); control.max = String(max); control.step = String(step); control.placeholder = '自動 / 基本に従う'; }
    const value = (current() as Record<string, unknown>)[key]; control.value = value === undefined ? '' : String(value);
    control.addEventListener('change', () => { if (control.value === '__mixed__') return; const props = { ...current() } as Record<string, unknown>; if (!control.value) delete props[key]; else props[key] = options ? ['columns', 'fontWeight'].includes(key) ? Number(control.value) : ['keepWithNext', 'showHeads', 'showFolio'].includes(key) ? control.value === 'true' : control.value : Number(control.value); edit(props as P, key); });
    row.append(control); parent.append(row);
  };
  if (kind === 'character') {
    add('fontFamily', '書体', FONT_CATALOG.map(font => [font.family, font.label]));
    add('fontWeight', '太さ', [['400', '標準'], ['700', '太字']]); add('fontPt', '文字サイズ / pt', undefined, 5, 36);
    add('letterSpacingEm', '字間 / 字', undefined, 0, 1, .05);
    add('orientation', '英字の向き', [['mixed', '自動（欧文は横倒し）'], ['upright', '一文字ずつ正立'], ['sideways', '横倒し']]);
    add('numbers', '数字の組み方', [['auto', '自動（2桁は縦中横）'], ['tcy', '縦中横'], ['upright', '一文字ずつ正立'], ['sideways', '横倒し'], ['kanji', '漢数字で表示']]);
    add('emphasis', '圏点', [['none', 'なし'], ['sesame', 'ごま点'], ['dot', '黒丸'], ['circle', '白丸'], ['triangle', '三角']]);
  } else if (kind === 'paragraph') {
    add('alignment', '行の中での揃え', [['start', '先頭（縦書きは上）'], ['center', '中央'], ['end', '末尾（縦書きは下）']]);
    add('indentEm', '最初の一行の字下げ / 字', undefined, 0, 8, .5); add('insetEm', '段落全体の字下げ / 字', undefined, 0, 20, .5); add('endInsetEm', '末尾側の余白 / 字', undefined, 0, 20, .5);
    add('beforeEm', '段落の前の空き / 字', undefined, 0, 20, .5); add('afterEm', '段落の後の空き / 字', undefined, 0, 20, .5); add('lineHeight', '行送り / 文字サイズの倍', undefined, 1.55, 3, .05);
    add('keepWithNext', '次の段落', [['true', '分離しない'], ['false', '自動で流す']]);
    add('orphans', '段落の先頭に残す最少行数', undefined, 1, 10, 1);
    add('widows', '段落の末尾に残す最少行数', undefined, 1, 10, 1);
  } else {
    add('writingMode', '書字方向', [['vertical-rl', '縦書き'], ['horizontal-tb', '横書き']]); add('columns', '段組', [['1', '一段'], ['2', '二段']]); add('columnGapMm', '段と段の間 / mm', undefined, 2, 30, .5);
    add('fontPt', '本文の文字サイズ / pt', undefined, 7, 18); add('lineHeight', '行送り / 文字サイズの倍', undefined, 1.55, 3, .05);
    add('maxCharsPerLine', '一行の字数', undefined, 1, 200, 1); add('maxLinesPerPage', '一段の行数', undefined, 1, 200, 1);
    for (const [key, name] of [['topMm', '上'], ['bottomMm', '下'], ['innerMm', 'ノド / 右'], ['outerMm', '小口 / 左']] as const) {
      const row = document.createElement('label'); row.className = 'select-label'; row.textContent = `${name}の余白 / mm`;
      const control = document.createElement('input'); control.id = `${prefix}-${key}`; control.type = 'number'; control.min = '5'; control.max = '70'; control.step = '.5'; control.placeholder = '本全体に従う'; control.value = String((current() as PageProperties).margins?.[key] ?? '');
      control.addEventListener('change', () => { const props = { ...current() } as PageProperties, margins = { ...props.margins }; if (!control.value) delete margins[key]; else margins[key] = Number(control.value); if (Object.keys(margins).length) props.margins = margins; else delete props.margins; edit(props as P, 'margins'); }); row.append(control); parent.append(row);
    }
    add('showHeads', '柱', [['true', '表示'], ['false', 'この範囲では非表示']]); add('showFolio', 'ノンブル', [['true', '表示'], ['false', 'この範囲では非表示']]);
  }
}
