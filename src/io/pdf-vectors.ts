import type { BookPage, BookStyle, RenderElement } from '../domain/contracts.js';
import type { Publication } from '../domain/model.js';
import { originalBytes } from './bundle.js';
import { paperHex } from '../domain/colors.js';
import { rasterize, pngBlob, type RasterOptions } from './raster.js';

interface PDFBox { x: number; y: number; width: number; height: number }
interface SourcePage { node: { get(key: unknown): unknown }; getCropBox(): PDFBox; getMediaBox(): PDFBox; getRotation(): { angle: number } }
interface SourcePDF { context: { lookup(value: unknown): unknown }; getPage(index: number): SourcePage }
interface EmbeddedPage { ref: unknown; embed(): Promise<void> }
export interface VectorPage {
  node: { newXObject(tag: string, reference: unknown): unknown };
  pushOperators(...operators: unknown[]): void;
  drawRectangle(options: { x: number; y: number; width: number; height: number; color: unknown }): void;
  drawImage(image: unknown, options: { x: number; y: number; width: number; height: number }): void;
}
export interface VectorDocument {
  context: { lookup(reference: unknown): { dict: { set(key: unknown, value: unknown): void } } };
  embedPage(page: SourcePage, bounds: { left: number; bottom: number; right: number; top: number }): Promise<EmbeddedPage>;
  embedPng(bytes: Uint8Array): Promise<unknown>;
}
export interface VectorLibrary {
  PDFDocument: { load(bytes: Uint8Array, options: { updateMetadata: false }): Promise<SourcePDF> };
  PDFName: { of(value: string): unknown };
  PDFObjectCopier: { for(source: unknown, target: unknown): { copy(value: unknown): unknown } };
  pushGraphicsState(): unknown; popGraphicsState(): unknown;
  concatTransformationMatrix(a: number, b: number, c: number, d: number, e: number, f: number): unknown;
  drawObject(name: unknown): unknown; rectangle(x: number, y: number, width: number, height: number): unknown;
  clip(): unknown; endPath(): unknown; rgb(r: number, g: number, b: number): unknown;
}
export function preservedPDFPages(pdf: VectorDocument, lib: VectorLibrary, book: Publication, style: BookStyle, signal: AbortSignal, usedBytes: (bytes: number) => void, raster: RasterOptions = {}) {
  const assets = new Map((book.assets ?? []).filter(a => a.mediaType === 'application/pdf').map(a => [a.id, a]));
  const sources = new Map<string, Promise<SourcePDF>>(), embedded = new Map<string, Promise<{ form: EmbeddedPage; crop: PDFBox; rotation: number }>>();
  const isPDF = (element: RenderElement) => element.kind === 'image' && assets.has(element.sourceAssetId ?? '');
  const pt = 72 / 25.4, width = style.page.widthMm * pt, height = style.page.heightMm * pt;
  async function embed(element: RenderElement) {
    const id = element.sourceAssetId!, index = (element.sourceAssetPage ?? 1) - 1, key = `${id}:${index}`;
    if (!embedded.has(key)) embedded.set(key, (async () => {
      signal.throwIfAborted(); const asset = assets.get(id)!;
      if (!sources.has(id)) { const bytes = originalBytes(asset.original); usedBytes(bytes.byteLength); sources.set(id, lib.PDFDocument.load(bytes, { updateMetadata: false })); }
      const source = await sources.get(id)!, page = source.getPage(index), name = lib.PDFName.of;
      const annotations = page.node.get(name('Annots'));
      if (annotations && (source.context.lookup(annotations) as { size(): number }).size()) throw new Error(`${asset.name} に注釈またはフォームがあります。画像PDFを選ぶと表示どおりに出力できます。`);
      const cropBox = page.getCropBox(), media = page.getMediaBox();
      const left = Math.max(cropBox.x, media.x), bottom = Math.max(cropBox.y, media.y), right = Math.min(cropBox.x + cropBox.width, media.x + media.width), top = Math.min(cropBox.y + cropBox.height, media.y + media.height);
      const crop = right > left && top > bottom ? { x: left, y: bottom, width: right - left, height: top - bottom } : media;
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(rotation)) throw new Error(`${asset.name} の回転角度に対応していません。画像PDFを選んでください。`);
      const form = await pdf.embedPage(page, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height }); await form.embed();
      const group = page.node.get(name('Group'));
      if (group) pdf.context.lookup(form.ref).dict.set(name('Group'), lib.PDFObjectCopier.for(source.context, pdf.context).copy(group));
      return { form, crop, rotation };
    })());
    return embedded.get(key)!;
  }
  async function layer(page: BookPage, target: VectorPage, elements: readonly RenderElement[], decorations: boolean): Promise<void> {
    if (!elements.length && !decorations) return;
    const content: BookPage = { ...page, elements, ...(!decorations ? { lines: [], runningElements: [], hideHeads: true, folioVisible: false } : {}) };
    const canvas = await rasterize(content, style, true, raster);
    try { signal.throwIfAborted(); const bytes = new Uint8Array(await (await pngBlob(canvas)).arrayBuffer()); usedBytes(bytes.byteLength); target.drawImage(await pdf.embedPng(bytes), { x: -(raster.bleedMm ?? 0) * pt, y: -(raster.bleedMm ?? 0) * pt, width: width + 2 * (raster.bleedMm ?? 0) * pt, height: height + 2 * (raster.bleedMm ?? 0) * pt }); }
    finally { canvas.width = 0; canvas.height = 0; }
  }
  return {
    hasPDF(page: BookPage): boolean { return (page.elements ?? []).some(isPDF); },
    async draw(page: BookPage, target: VectorPage): Promise<void> {
      const paper=paperHex(page.paperColor??page.style?.paperColor??style.paperColor),channels=[1,3,5].map(offset=>parseInt(paper.slice(offset,offset+2),16)/255);
      target.drawRectangle({ x: -(raster.bleedMm ?? 0) * pt, y: -(raster.bleedMm ?? 0) * pt, width: width + 2 * (raster.bleedMm ?? 0) * pt, height: height + 2 * (raster.bleedMm ?? 0) * pt, color: lib.rgb(channels[0]!,channels[1]!,channels[2]!) });
      let pending: RenderElement[] = [];
      for (const element of page.elements ?? []) {
        signal.throwIfAborted();
        if (!isPDF(element)) { pending.push(element); continue; }
        await layer(page, target, pending, false); pending = [];
        const { form, crop, rotation } = await embed(element), odd = rotation % 180 !== 0;
        const boxW = element.widthMm * pt, boxH = element.heightMm * pt, x = element.xMm * pt, y = height - (element.yMm + element.heightMm) * pt;
        const naturalW = odd ? crop.height : crop.width, naturalH = odd ? crop.width : crop.height;
        const scale = element.fit === 'cover' ? Math.max(boxW / naturalW, boxH / naturalH) : Math.min(boxW / naturalW, boxH / naturalH);
        const tx = x + (boxW - naturalW * scale) / 2, ty = y + (boxH - naturalH * scale) / 2;
        const matrix: [number, number, number, number, number, number] = rotation === 90 ? [0, -scale, scale, 0, tx, ty + crop.width * scale] : rotation === 180 ? [-scale, 0, 0, -scale, tx + crop.width * scale, ty + crop.height * scale] : rotation === 270 ? [0, scale, -scale, 0, tx + crop.height * scale, ty] : [scale, 0, 0, scale, tx, ty];
        const object = target.node.newXObject('SourcePage', form.ref);
        target.pushOperators(lib.pushGraphicsState(), lib.rectangle(x, y, boxW, boxH), lib.clip(), lib.endPath(), lib.concatTransformationMatrix(...matrix));
        // PDF previews are rendered on white; retain that source paper inside the placed page.
        target.drawRectangle({x:0,y:0,width:crop.width,height:crop.height,color:lib.rgb(1,1,1)});
        target.pushOperators(lib.drawObject(object), lib.popGraphicsState());
      }
      await layer(page, target, pending, true); signal.throwIfAborted();
    },
  };
}
