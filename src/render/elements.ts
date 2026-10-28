import type { RenderElement } from '../domain/contracts.js';
import { elementTextLines } from '../domain/element-layout.js';
import { verticalText } from './text.js';
/** Deterministic text boxes, shared by special-page preview and export. */
export function renderElements(elements: readonly RenderElement[], escape: (s: string) => string, prefix: string, family = 'Book Mincho'): string {
  return elements.map((e, index) => {
    const box = `data-element-id="${escape(e.id)}"`, clipId = `${prefix}-clip-${index}`, clip = `<clipPath id="${clipId}"><rect x="${e.xMm}" y="${e.yMm}" width="${e.widthMm}" height="${e.heightMm}"/></clipPath>`;
    let content = '';
    if (e.kind === 'image' && e.dataUrl) content = `<image href="${escape(e.dataUrl)}" x="${e.xMm}" y="${e.yMm}" width="${e.widthMm}" height="${e.heightMm}" preserveAspectRatio="xMidYMid ${e.fit === 'cover' ? 'slice' : 'meet'}"/>`;
    else if (e.kind === 'line') content = `<line x1="${e.xMm}" x2="${e.xMm + e.widthMm}" y1="${e.yMm}" y2="${e.yMm + e.heightMm}" stroke="${escape(e.color ?? '#333333')}" stroke-width="${e.strokeMm ?? .2}"/>`;
    else if (e.kind === 'rect') content = `<rect x="${e.xMm}" y="${e.yMm}" width="${e.widthMm}" height="${e.heightMm}" fill="none" stroke="${escape(e.color ?? '#333333')}" stroke-width="${e.strokeMm ?? .2}"/>`;
    else if (e.kind === 'text') {
      const selectedFont=e.fontFamily??family;
      const size = (e.fontPt ?? 10) * 25.4 / 72, vertical = e.direction === 'vertical';
      const lines = elementTextLines(e.text ?? '', (vertical ? e.heightMm : e.widthMm) / size, selectedFont);
      content = lines.map((text, at) => {
        if (vertical) return verticalText(text,e.xMm+e.widthMm-size*.7-at*size*1.6,e.yMm,size,escape,`font-family="'${escape(selectedFont)}','Book Mincho',serif" font-weight="${e.fontWeight ?? 400}"`,'mixed',selectedFont);
        const x = e.alignment === 'center' ? e.xMm + e.widthMm / 2 : e.alignment === 'end' ? e.xMm + e.widthMm : e.xMm;
        return `<text font-family="'${escape(selectedFont)}','Book Mincho',serif" x="${x}" y="${e.yMm + size + at * size * 1.65}" font-size="${size}" font-weight="${e.fontWeight ?? 400}" text-anchor="${e.alignment === 'center' ? 'middle' : e.alignment === 'end' ? 'end' : 'start'}">${escape(text)}</text>`;
      }).join('');
    }
    return `${clip}<g ${box} clip-path="url(#${clipId})">${content}</g>`;
  }).join('');
}
