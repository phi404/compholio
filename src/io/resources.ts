import { fontDefinition } from '../domain/fonts.js';
/** URLs follow the installed app directory, including a GitHub Pages project path. */
const pdfRoot = new URL('../vendor/pdfjs/', import.meta.url);
export function fontResource(family: string) {
  const font=fontDefinition(family);
  return {...font,url:new URL('../'+font.path,import.meta.url),licenseURL:new URL('../'+font.license,import.meta.url)};
}
export const bundledFont = {...fontResource('Book Mincho'),name:'Noto Serif JP Regular'};
export const bundledResources = {
  font: bundledFont.url,
  pdfWorker: new URL('pdf.worker.mjs', pdfRoot).href,
  pdfOptions: {
    cMapUrl: new URL('cmaps/', pdfRoot).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', pdfRoot).href,
    wasmUrl: new URL('wasm/', pdfRoot).href,
    iccUrl: new URL('iccs/', pdfRoot).href,
    useWorkerFetch: true,
  },
};
