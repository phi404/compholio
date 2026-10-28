import type { Block, BookStyle, CharacterProperties, DecorationPosition, ParagraphProperties, ViewMode } from './contracts.js';

export type SourceSyntax = 'text' | 'markdown';
export interface PageProperties { writingMode?: BookStyle['writingMode']; columns?: 1 | 2; columnGapMm?: number; fontPt?: number; lineHeight?: number; margins?: Partial<BookStyle['margins']>; maxCharsPerLine?: number; maxLinesPerPage?: number; showHeads?: boolean; showFolio?: boolean }
export interface SectionProperties { pageStyleId?: string; paragraphStyleId?: string; start?: 'continuous' | 'next' | 'left' | 'right' | 'recto'; numberStart?: number; numberFormat?: 'decimal' | 'roman' | 'Roman'; paragraph?: ParagraphProperties; character?: CharacterProperties; page?: PageProperties }
export interface LocalStyle { paragraph?: ParagraphProperties; character?: CharacterProperties; page?: PageProperties; pageStyleId?: string }
export type SpecialRole = 'title' | 'chapter-title' | 'toc' | 'colophon' | 'illustration' | 'free' | 'external';
export type SpecialPageRef = { kind: 'specialPage'; id: string; pageId: string; role: SpecialRole };
export type TreeBlock = (Block | SpecialPageRef) & { role?: 'body' | 'quote' | SpecialRole; sourceStyle?: ParagraphProperties; styleId?: string; localStyle?: LocalStyle };
export interface Section { kind: 'section'; id: string; role: 'body' | 'chapter'; headingId?: string; start?: 'continuous' | 'next' | 'left' | 'right' | 'recto'; styleId?: string; localStyle?: SectionProperties; children: TreeBlock[] }
export interface DocumentTree { schemaVersion: 2; kind: 'document'; title: string; author: string; nextId: number; children: Section[] }
export interface NamedStyle<P> { id: string; name: string; basedOn?: string; properties: P; characterStyleId?: string }
export interface StyleCatalog {
  characters: NamedStyle<CharacterProperties>[];
  paragraphs: NamedStyle<ParagraphProperties>[];
  headings: NamedStyle<ParagraphProperties>[];
  pages?: NamedStyle<PageProperties>[];
  sections?: NamedStyle<SectionProperties>[];
}
/** Physical page ranges are only evaluated after pagination. Text ranges are a later editor concern. */
export type Scope = { kind: 'book' } | { kind: 'section'; sectionId: string } | { kind: 'block'; blockId: string }
  | { kind: 'blockRange'; fromId: string; toId: string } | { kind: 'untilSection'; fromId: string }
  | { kind: 'pages'; from: number; to: number | null };
export type ScopedStyle = LocalStyle & { id: string; scope: Scope };
export interface RunningElement {
  id: string; scope: Scope;
  content: { kind: 'text'; text: string } | { kind: 'title' | 'author' | 'chapter' | 'heading' | 'pageNumber' };
  fontFamily?: string; position: DecorationPosition; side: 'both' | 'odd' | 'even'; fontPt: number; insetMm: number; hideOnSectionFirst: boolean;
}
export interface PrintSettings { purpose: 'screen' | 'print'; bleedMm: number; marks: 'none' | 'corners' | 'all'; dpi: 300 | 350 | 600; color: 'rgb' | 'gray'; pdfSource: 'raster' | 'preserve' }
export interface Publication {
  schemaVersion: 3; syntax: 'markdown'; source: string; document: DocumentTree; styles: StyleCatalog; style: BookStyle;
  overrides: ScopedStyle[]; runningElements: RunningElement[];
  printSettings?: PrintSettings;
  metadata?: { filename: string; viewMode: ViewMode; selected: number };
  specialPages?: SpecialPageDefinition[]; assets?: BookAsset[]; pageOverrides?: PageOverride[]; sourceDraft?: string;
}
export type ElementBox = { id: string; xMm: number; yMm: number; widthMm: number; heightMm: number; locked?: boolean };
export type PageElement = ElementBox & (
  { kind: 'text'; text: string; fontFamily?: string; fontPt: number; fontWeight: 400 | 700; alignment: 'start' | 'center' | 'end'; direction: 'horizontal' | 'vertical' }
  | { kind: 'image'; assetId: string; assetPage: number; fit: 'contain' | 'cover' }
  | { kind: 'line' | 'rect'; color: string; strokeMm: number }
);
export interface TocOptions { depth: 1 | 2 | 3; fontPt: number; indentMm: number }
export interface SpecialPageDefinition {
  id: string; role: SpecialRole; name: string; representation: 'template' | 'layout' | 'asset';
  toc?: TocOptions;
  template: 'standard' | 'minimal'; fields: Record<string, string>; elements: PageElement[];
  assetId: string | null; assetPage: number; fit: 'contain' | 'cover';
  originalTemplate?: { template: 'standard' | 'minimal'; fields: Record<string, string> };
  imageMode?: 'flow' | 'page' | 'spread' | 'bleed' | 'external'; bleedMm?: number; snapMm?: number;
  caption?: { text: string; numbered: boolean; fontPt: number };
  pageStyleId?: string; localStyle?: PageProperties;
}
export interface AssetImage { dataUrl: string; width: number; height: number; widthMm?: number; heightMm?: number }
export interface BookAsset { id: string; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/svg+xml' | 'application/pdf'; original: string; bytes: number; images: AssetImage[] }
/** Physical overrides never change text capacity. A sparse page set preserves holes. */
export interface PageOverride { id: string; pages: number[]; folio?: boolean; hideHeads?: boolean; paperColor?: BookStyle['paperColor'] }
export type BookModel = Publication & { schemaVersion: 3; specialPages: SpecialPageDefinition[]; assets: BookAsset[]; pageOverrides: PageOverride[] };
