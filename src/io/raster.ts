import type { BookStyle, BookPage } from '../domain/contracts.js';
import { renderPageSVG } from '../render/svg.js';
import { pageFontData } from './fonts.js';
import { paperHex } from '../domain/colors.js';
export const DPI = 300;
export const PAGE_PIXELS = { width: Math.round(105 * DPI / 25.4), height: Math.round(148 * DPI / 25.4) };
export const pagePixels = (style: BookStyle) => ({ width: Math.round(style.page.widthMm * DPI / 25.4), height: Math.round(style.page.heightMm * DPI / 25.4) });
export interface RasterOptions { dpi?: number; bleedMm?: number; blackText?: boolean }
export async function rasterize(page: BookPage, style: BookStyle, transparent = false, options: RasterOptions = {}): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  // Paint paper once on the destination; a second antialiased SVG edge can shift RGB values.
  const svg = renderPageSVG(page, style, await pageFontData(page,style), true, options);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const bleed = options.bleedMm ?? 0, dpi = options.dpi ?? DPI, size = page.style?.page ?? style.page;
  const pixels = { width: Math.round((size.widthMm + 2 * bleed) * dpi / 25.4), height: Math.round((size.heightMm + 2 * bleed) * dpi / 25.4) }, canvas = document.createElement('canvas');
  if (pixels.width * pixels.height > 40_000_000) throw new Error('ページ画像が大きすぎます。判型か解像度を小さくしてください。');
  canvas.width = pixels.width; canvas.height = pixels.height;
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('ページ画像を生成できませんでした。')); image.src = url; });
    const context = canvas.getContext('2d'); if (!context) throw new Error('画像を生成できません。');
    if (!transparent) { context.fillStyle = paperHex(page.paperColor ?? page.style?.paperColor ?? style.paperColor); context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas;
  } finally { URL.revokeObjectURL(url); image.src = ''; }
}
export async function rasterizeSpread(left: BookPage | undefined, right: BookPage | undefined, style: BookStyle): Promise<HTMLCanvasElement> {
  const pixels = pagePixels(style), canvas = document.createElement('canvas'); canvas.width = pixels.width * 2; canvas.height = pixels.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('画像を生成できません。');
  context.fillStyle = paperHex(style.paperColor); context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    for (const [index, page] of [left, right].entries()) if (page) {
      const single = await rasterize(page, style); try { context.drawImage(single, pixels.width * index, 0); } finally { single.width = 0; single.height = 0; }
    }
    return canvas;
  } catch (error) { canvas.width = 0; canvas.height = 0; throw error; }
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNGを生成できませんでした。')), 'image/png'));
  const original = new Uint8Array(await blob.arrayBuffer());
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
  view.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
  const pixelsPerMeter = Math.round(DPI / 0.0254); view.setUint32(8, pixelsPerMeter); view.setUint32(12, pixelsPerMeter); chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  return new Blob([original.subarray(0, 33), chunk, original.subarray(33)], { type: 'image/png' });
}
