/** Domain data only. No browser, filesystem or layout computation here. */
export type Emphasis = 'sesame' | 'dot' | 'circle' | 'triangle';
export type CharacterProperties = { fontFamily?: string; fontWeight?: 400 | 700; fontPt?: number; letterSpacingEm?: number; orientation?: 'mixed' | 'upright' | 'sideways'; numbers?: 'auto' | 'tcy' | 'upright' | 'sideways' | 'kanji'; emphasis?: Emphasis | 'none' };
export type ParagraphProperties = { indentEm?: number; insetEm?: number; endInsetEm?: number; beforeEm?: number; afterEm?: number; lineHeight?: number; alignment?: 'start' | 'center' | 'end'; keepWithNext?: boolean; orphans?: number; widows?: number };
export type TextInline = { kind: 'text'; text: string; strong?: boolean; styleId?: string; localStyle?: CharacterProperties } & CharacterProperties;
export type RubyInline = { kind: 'ruby'; base: string; reading: string; strong?: boolean; styleId?: string; localStyle?: CharacterProperties } & CharacterProperties;
export type Inline = TextInline | RubyInline;
export type Paragraph = { id: string; kind: 'paragraph'; indent: 'auto' | 'none'; inlines: readonly Inline[] } & ParagraphProperties;
export type Heading = { id: string; kind: 'heading'; level: number; keepWithNext: boolean; inlines: readonly Inline[] } & ParagraphProperties;
export type PageBreak = { id: string; kind: 'pageBreak'; start: 'next' | 'left' | 'right' | 'recto' };
export type Block = Paragraph | Heading | PageBreak;
export interface Document {
  schemaVersion: 1;
  title: string;
  blocks: readonly Block[];
}
export type PaperColor = 'white' | 'warm' | `#${string}`;
export interface BookStyle {
  page: { widthMm: number; heightMm: number };
  writingMode: 'vertical-rl' | 'horizontal-tb';
  binding: 'right' | 'left';
  columns: number;
  columnGapMm?: number;
  fontFamily: string;
  fontPt: number;
  lineHeight: number;
  margins: { topMm: number; bottomMm: number; innerMm: number; outerMm: number };
  maxCharsPerLine?: number;
  maxLinesPerPage?: number;
  pageLayout?: 'book' | 'uniform';
  paragraphIndent?: boolean;
  paperColor?: PaperColor;
  textColor?: string;
  folio?: FolioStyle;
  runningHeads?: readonly RunningHead[];
  pageCountMultiple?: 1 | 2 | 4 | 8 | 16;
}
export type DecorationPosition = 'top-left' | 'top-center' | 'top-right' | 'top-outer' | 'top-inner' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'bottom-outer' | 'bottom-inner';
export interface PageRange { id: string; from: number; to: number | null }
export interface FolioRule extends PageRange { enabled: boolean; startNumber?: number }
export interface FolioStyle {
  enabled: boolean; fromPage: number; startNumber: number; position: DecorationPosition;
  fontFamily?: string; fontPt: number; insetMm: number; rules: readonly FolioRule[];
}
export interface RunningHead extends PageRange {
  side: 'both' | 'odd' | 'even'; position: 'top-left' | 'top-center' | 'top-right' | 'top-outer' | 'top-inner';
  text: string; fontFamily?: string; fontPt: number; insetMm: number;
}
export interface FlowLine {
  blockId: string;
  indentEm: number;
  column?: number;
  fontScale?: number;
  heading?: boolean;
  alignment?: 'start' | 'center' | 'end';
  runs: readonly (Inline & { advanceEm?: number; sizeMm?: number; tcy?: boolean; displayText?: string; textFrom?: number; textTo?: number })[];
  band?: number;
  xMm?: number;
  yMm?: number;
  lengthMm?: number;
}
export interface ResolvedRunningElement { id: string; text: string; position: DecorationPosition; fontFamily?: string; fontPt: number; insetMm: number }
export interface ImagePrintInfo { placement: 'flow' | 'page' | 'spread' | 'bleed' | 'external'; effectiveDpi: number; trimMm: [number, number]; bleedMm: number; sourcePixels: [number, number]; originalMm?: [number, number] }
export interface FlowPage { kind: 'flow'; number: number; lines: readonly FlowLine[]; heading?: string; sectionId?: string; runningElements?: readonly ResolvedRunningElement[]; paperColor?: PaperColor; folioVisible?: boolean; folioLabel?: string | null; generatedBlank?: boolean; hideHeads?: boolean; style?: BookStyle; elements?: readonly RenderElement[]; imageInfo?: ImagePrintInfo[] }
export interface RenderElement {
  id: string; kind: 'text' | 'image' | 'line' | 'rect'; xMm: number; yMm: number; widthMm: number; heightMm: number;
  text?: string; fontFamily?: string; fontPt?: number; fontWeight?: 400 | 700; alignment?: 'start' | 'center' | 'end'; direction?: 'horizontal' | 'vertical';
  dataUrl?: string; fit?: 'contain' | 'cover'; color?: string; strokeMm?: number;
  blockId?: string; imagePlacement?: ImagePrintInfo['placement'];
  sourceAssetId?: string; sourceAssetPage?: number;
}
export type SpecialRenderedPage = Omit<FlowPage, 'kind' | 'imageInfo'> & { kind: 'structured' | 'layout' | 'asset'; pageId: string; blockId: string; elements: readonly RenderElement[]; name: string; imageInfo?: ImagePrintInfo };
export type BookPage = FlowPage | SpecialRenderedPage;
export interface Diagnostic { code: string; message: string; blockId?: string; pageNumber?: number; elementId?: string }
export interface RenderedPages {
  pages: readonly BookPage[];
  diagnostics: readonly Diagnostic[];
}
export type ViewMode = 'spread' | 'single' | 'gallery';
export interface Project { schemaVersion: 1; source: string; document: Document; style: BookStyle; metadata?: { filename: string; viewMode: ViewMode; selected: number } }
