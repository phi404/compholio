import { FONT_UNITS_PER_EM, FONT_VERTICAL_ORIGIN, VERTICAL_GLYPHS, VERTICAL_ORIGINS } from './vertical-font.js';
import { FONT_VARIANTS } from './font-variants.js';

export interface FontData { units: number; origin: number; glyphs: Readonly<Record<string, readonly [string, number]>>; origins: Readonly<Record<string, number>> }
const mincho: FontData = { units: FONT_UNITS_PER_EM, origin: FONT_VERTICAL_ORIGIN, glyphs: VERTICAL_GLYPHS, origins: VERTICAL_ORIGINS };
export function fontData(family = 'Book Mincho'): FontData {
  const data = family === 'Book Mincho' ? mincho : FONT_VARIANTS[family];
  if (!data) throw new Error('書体の描画データがありません。');
  return data;
}
