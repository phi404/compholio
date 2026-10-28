import { advance, graphemes } from './style.js';
import type { PageElement } from './model.js';
/** Text-box wrapping and capacity are resolved once for all rendering targets. */
export function elementTextLines(text: string, capacity: number, family = 'Book Mincho'): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '', used = 0;
    for (const char of graphemes(paragraph)) {
      const width = advance(char,family); if (line && used + width > capacity) { lines.push(line); line = ''; used = 0; }
      line += char; used += width;
    }
    lines.push(line);
  }
  return lines;
}
export function textBoxOverflows(e: Extract<PageElement, { kind: 'text' }>, family = 'Book Mincho'): boolean {
  const size = e.fontPt * 25.4 / 72, vertical = e.direction === 'vertical';
  const lines = elementTextLines(e.text, (vertical ? e.heightMm : e.widthMm) / size, e.fontFamily ?? family);
  const capacity = vertical ? e.widthMm : e.heightMm;
  return lines.length > 0 && size + (lines.length - 1) * size * (vertical ? 1.6 : 1.65) > capacity + .001;
}
