import { tocEntries } from '../domain/navigation.js';
import { finishBookPages, sectionNumbering } from '../domain/numbering.js';
import { captionedPages } from '../domain/figures.js';
import type { LayoutPublication } from '../domain/layout-input.js';
import type { BookStyle, CharacterProperties, Diagnostic, ParagraphProperties, RenderedPages, ResolvedRunningElement, RenderElement } from '../domain/contracts.js';
import type { Scope, PageProperties } from '../domain/model.js';
import { flattenDocument } from '../domain/publication.js';
import { blockStyleId, inheritedStyle, validateCatalog, validateLocal } from '../domain/styles.js';
import { scopePriority, validateScope } from '../domain/scope.js';
import { validateRunningElement } from '../domain/running.js';
import { decorationSide, folioNumber, headsForPage } from '../domain/decoration.js';
import { validateStyle } from '../domain/style.js';
import { paginate } from './paginator.js';
import type { PaginationBlock } from './paginator.js';
import { newSpecialPage } from '../domain/special.js';
import { templateElements, templatePages } from '../domain/templates.js';
import { textBoxOverflows } from '../domain/element-layout.js';
import type { PageElement } from '../domain/model.js';
import { imagePrintInfo } from '../domain/image-print.js';

/** Resolve semantic styles before pagination; evaluate physical-page decorations afterwards. */
export function typesetPublication(project: LayoutPublication): RenderedPages {
  const tree = project.document, catalog = validateCatalog(project.styles), style = validateStyle(project.style), original = flattenDocument(tree);
  const blockIndex = new Map(original.map((b, i) => [b.id, i])), sectionByBlock = new Map(tree.children.flatMap(s => s.children.map(b => [b.id, s.id] as const))), sections = new Map(tree.children.map(s => [s.id, s]));
  const diagnostics: Diagnostic[] = [];
  const exists = (scope: Scope) => scope.kind === 'book' || scope.kind === 'pages' ? true : scope.kind === 'section' ? sections.has(scope.sectionId) : scope.kind === 'block' ? blockIndex.has(scope.blockId) : scope.kind === 'untilSection' ? blockIndex.has(scope.fromId) : blockIndex.has(scope.fromId) && blockIndex.has(scope.toId) && blockIndex.get(scope.fromId)! <= blockIndex.get(scope.toId)!;
  const matches = (scope: Scope, blockId: string | undefined, sectionId: string | undefined, pageNumber?: number) => {
    switch (scope.kind) {
      case 'book': return true;
      case 'section': return scope.sectionId === sectionId;
      case 'block': return scope.blockId === blockId;
      case 'untilSection': return blockIndex.has(scope.fromId) && sectionByBlock.get(scope.fromId) === sectionId && blockIndex.get(blockId ?? '') !== undefined && blockIndex.get(blockId ?? '')! >= blockIndex.get(scope.fromId)!;
      case 'pages': return pageNumber !== undefined && pageNumber >= scope.from && (scope.to === null || pageNumber <= scope.to);
      case 'blockRange': { const at = blockIndex.get(blockId ?? ''); return at !== undefined && exists(scope) && at >= blockIndex.get(scope.fromId)! && at <= blockIndex.get(scope.toId)!; }
    }
  };
  for (const entry of [...project.overrides, ...project.runningElements]) { validateScope(entry.scope); if (!exists(entry.scope)) diagnostics.push({ code: 'scope-orphan', message: '削除された章・段落を参照する設定があります。適用先を変更するか、設定を削除してください。' }); }
  for (const rule of project.overrides) { validateLocal({ ...(rule.paragraph ? { paragraph: rule.paragraph } : {}), ...(rule.character ? { character: rule.character } : {}), ...(rule.page ? { page: rule.page } : {}), ...(rule.pageStyleId ? { pageStyleId: rule.pageStyleId } : {}) }); if (rule.scope.kind === 'pages') throw new Error('本文容量を変える書式には章・段落の範囲を使ってください。'); }
  for (const element of project.runningElements) validateRunningElement(element, style);
  const rules = [...project.overrides].sort((a, b) => scopePriority(a.scope) - scopePriority(b.scope));
  const paragraphStyles = new Map(catalog.paragraphs.map(s => [s.id, inheritedStyle(catalog.paragraphs, s.id)])), headingStyles = new Map(catalog.headings.map(s => [s.id, inheritedStyle(catalog.headings, s.id)])), characterStyles = new Map(catalog.characters.map(s => [s.id, inheritedStyle(catalog.characters, s.id).properties]));
  const pageStyles = new Map(catalog.pages!.map(s => [s.id, inheritedStyle(catalog.pages!, s.id).properties]));
  const pageProps = (id: string | undefined): PageProperties => { if (!id) return {}; const properties = pageStyles.get(id); if (!properties) throw new Error(`スタイル「${id}」が見つかりません。`); return properties; };
  const mergePage = (a: PageProperties, b: PageProperties = {}): PageProperties => ({...a,...b,...(a.margins||b.margins?{margins:{...a.margins,...b.margins}}:{})});
  const resolvedSections = new Map(tree.children.map(section => {
    const base = section.styleId ? inheritedStyle(catalog.sections!, section.styleId).properties : {};
    return [section.id, { ...base, ...section.localStyle, paragraph: { ...base.paragraph, ...section.localStyle?.paragraph }, character: { ...base.character, ...section.localStyle?.character }, page: mergePage(base.page ?? {}, section.localStyle?.page) }];
  }));
  const baseKey = JSON.stringify(style), effectiveStyles = new Map<string, { value: BookStyle; changed: boolean }>([['{}', { value: style, changed: false }]]);
  const effectivePage = (properties: PageProperties) => {
    const key = JSON.stringify(properties), cached = effectiveStyles.get(key); if (cached) return cached;
    const value = validateStyle({ ...style, ...properties, margins: { ...style.margins, ...properties.margins } }), resolved = { value, changed: JSON.stringify(value) !== baseKey };
    if (effectiveStyles.size < 512) effectiveStyles.set(key, resolved); return resolved;
  };
  const blockPages = new Map<string, PageProperties>();
  const blocks = original.map((block): PaginationBlock => {
    const section = sections.get(sectionByBlock.get(block.id)??'')!, sectionProperties = resolvedSections.get(section.id)!;
    let pageProperties: PageProperties = catalog.pages!.some(p=>p.id==='default-page')?pageProps('default-page'):{};
    for (const rule of rules) if(rule.scope.kind==='book')pageProperties=mergePage(mergePage(pageProperties,pageProps(rule.pageStyleId)),rule.page);
    pageProperties=mergePage(pageProperties,pageProps(sectionProperties.pageStyleId));
    pageProperties=mergePage(pageProperties,sectionProperties.page);
    for (const rule of rules) if (rule.scope.kind!=='book' && matches(rule.scope,block.id,section.id)) pageProperties=mergePage(mergePage(pageProperties,pageProps(rule.pageStyleId)),rule.page);
    pageProperties=mergePage(mergePage(pageProperties,pageProps(block.localStyle?.pageStyleId)),block.localStyle?.page);
    const definition=block.kind==='specialPage'?project.specialPages?.find(p=>p.id===block.pageId):undefined;
    if(definition)pageProperties=mergePage(mergePage(pageProperties,pageProps(definition.pageStyleId)),definition.localStyle);
    blockPages.set(block.id,pageProperties);
    const {showHeads: _heads,showFolio: _folio,...layoutProps}=pageProperties;
    const resolved = effectivePage(layoutProps), effective = resolved.value, metadata={...(resolved.changed?{layoutStyle:effective}:{}),sectionId:section.id};
    if (block.kind === 'pageBreak') return {...block,...metadata};
    if (block.kind === 'specialPage') {
      const page = project.specialPages?.find(p => p.id === block.pageId) ?? newSpecialPage(block.pageId, block.role);
      let elements: RenderElement[] = [];
      if (page.representation === 'template') elements = templateElements(page, effective);
      else if (page.representation === 'layout') elements = page.elements.map(element => {
        if (element.kind !== 'image') return element;
        const image = project.assets?.find(a => a.id === element.assetId)?.images[element.assetPage - 1];
        if (!image) diagnostics.push({ code: 'asset-missing', blockId: block.id, elementId:element.id, message: '自由ページの画像素材が未指定または見つかりません。' });
        return { ...element, sourceAssetId: element.assetId, sourceAssetPage: element.assetPage, ...(image?.dataUrl ? { dataUrl: image.dataUrl } : {}) };
      });
      else {
        const asset = project.assets?.find(a => a.id === page.assetId), image = asset?.images[page.assetPage - 1];
        if (image) {
          const bleed=page.imageMode==='bleed'?page.bleedMm??3:0;
          elements = [{ id: 'asset-image', kind: 'image', xMm: -bleed, yMm: -bleed, widthMm: effective.page.widthMm+bleed*2, heightMm: effective.page.heightMm+bleed*2, ...(image.dataUrl ? { dataUrl: image.dataUrl } : {}), fit: page.fit, sourceAssetId: asset!.id, sourceAssetPage: page.assetPage, imagePlacement:page.imageMode??(page.role==='external'?'external':'page') }];
          if (image.width / style.page.widthMm * 25.4 < 150 || image.height / style.page.heightMm * 25.4 < 150) diagnostics.push({ code: 'image-resolution', blockId: block.id, message: '150dpi未満の画像があります。印刷時の解像度を確認してください。' });
          if (image.widthMm && image.heightMm && (Math.abs(image.widthMm - (effective.page.widthMm * (page.imageMode === 'spread' ? 2 : 1) + 2 * bleed)) > .5 || Math.abs(image.heightMm - (effective.page.heightMm + 2 * bleed)) > .5)) diagnostics.push({ code: 'asset-page-size', blockId: block.id, message: '外部PDFの仕上がり寸法が本と異なります。フィットで表示しています。' });
        } else diagnostics.push({ code: 'asset-missing', blockId: block.id, message: '挿絵・外部ページの素材を指定してください。' });
      }
      if (page.representation === 'template' && page.role !== 'toc' && !page.fields.title) diagnostics.push({ code: 'template-title-missing', blockId: block.id, message: '特殊ページの書名・章名が未入力です。「構成」でこのページを選び、内容を入力してください。' });
      const image=project.assets?.find(a=>a.id===page.assetId)?.images[page.assetPage-1];
      const bleed=page.imageMode==='bleed'?page.bleedMm??3:0;
      const info=page.representation==='asset'&&image?{...imagePrintInfo(image,effective.page.widthMm*(page.imageMode==='spread'?2:1)+2*bleed,effective.page.heightMm+2*bleed,page.fit,page.imageMode??(page.role==='external'?'external':'page'),bleed),trimMm:[effective.page.widthMm,effective.page.heightMm] as [number,number]}:undefined;
      return { kind: 'specialPage', id: block.id,...metadata, page: { kind: page.representation === 'template' ? 'structured' : page.representation === 'layout' ? 'layout' : 'asset', pageId: page.id, blockId: block.id, name: page.name, lines: [], elements,...(info?{imageInfo:info}: {}) } };
    }
    const styleId=block.kind==='paragraph'&&!block.styleId&&block.role!=='quote'&&sectionProperties.paragraphStyleId?sectionProperties.paragraphStyleId:blockStyleId(block);
    const named = (block.kind === 'heading' ? headingStyles : paragraphStyles).get(styleId); if (!named) throw new Error('文書のスタイル参照先が見つかりません。');
    let paragraph: ParagraphProperties = { ...named.properties, ...block.sourceStyle, ...(block.kind === 'paragraph' ? sectionProperties.paragraph : {}) }, character: CharacterProperties = { ...sectionProperties.character };
    for (const rule of rules) if (matches(rule.scope, block.id, sectionByBlock.get(block.id))) { paragraph = { ...paragraph, ...rule.paragraph }; character = { ...character, ...rule.character }; }
    paragraph = { ...paragraph, ...block.localStyle?.paragraph }; character = { ...character, ...block.localStyle?.character };
    const baseCharacter = characterStyles.get(named.characterStyleId ?? 'text');
    const inlines = block.inlines.map(run => ({ ...run,numbers:'auto' as const,...baseCharacter,...(run.styleId?characterStyles.get(run.styleId):{}),...(run.strong?{fontWeight:characterStyles.get('strong')?.fontWeight??700}:{}),...(run.emphasis?{emphasis:run.emphasis}:{}),...character,...run.localStyle }));
    return { ...block, ...paragraph, inlines,...metadata };
  });
  const expanded = blocks.flatMap((block): PaginationBlock[] => {
    const definition = block.kind === 'specialPage' ? project.specialPages?.find(p => p.id === block.page.pageId) : undefined;
    return definition?.role === 'toc' && definition.representation === 'template' && block.kind === 'specialPage'
      ? templatePages(definition, block.layoutStyle ?? style, tocEntries(project, definition)).map(elements => ({...block,page:{...block.page,elements}})) : [block];
  });
  const withStarts: PaginationBlock[] = [];
  const startedSections = new Set<string>();
  for (const block of expanded) {
    const section = sections.get(sectionByBlock.get(block.id) ?? '');
    if (section && !startedSections.has(section.id)) {
      const numbering = sectionNumbering({ ...project, styles: catalog }, section.id);
      const specified=section.start??section.localStyle?.start??(section.styleId?inheritedStyle(catalog.sections!,section.styleId).properties.start:undefined);
      const start = numbering.numberStart !== undefined || numbering.numberFormat ? specified && specified !== 'continuous' ? specified : 'next' : specified;
      if (start && start !== 'continuous' && (withStarts.length || start !== 'next')) withStarts.push({ kind: 'pageBreak', id: `start-${section.id}`, start,...(block.layoutStyle?{layoutStyle:block.layoutStyle}:{}) });
      startedSections.add(section.id);
    }
    withStarts.push(block);
  }
  const rawResult = paginate({ schemaVersion: 1, title: tree.title, blocks: withStarts }, style);
  const result = { ...rawResult, pages: captionedPages(project, rawResult.pages) }, firstPages = new Map<string, number>();
  const tocParts = new Map<string, number>();
  for (const page of result.pages) if (page.kind === 'structured') {
    const definition = project.specialPages?.find(p => p.id === page.pageId);
    if (definition?.role === 'toc') {
      const part = tocParts.get(page.pageId) ?? 0; tocParts.set(page.pageId, part + 1);
      page.elements = templatePages(definition, page.style??style, tocEntries(project, definition, result.pages))[part]!;
    }
  }
  for (const page of result.pages) if (page.kind !== 'flow') for (const e of page.elements) {
    const size=(page.style??style).page, intentional=e.kind==='image' && ['bleed','spread'].includes(e.imagePlacement??'');
    if (!intentional && (e.yMm<0 || e.xMm<0 || e.yMm + e.heightMm > size.heightMm || e.xMm + e.widthMm > size.widthMm)) diagnostics.push({ code: 'element-overflow', blockId: page.blockId, pageNumber:page.number, elementId:e.id, message: 'ページの内容が用紙からはみ出しています。サイズ・位置を確認してください。' });
    if (e.kind === 'text' && textBoxOverflows(e as Extract<PageElement, { kind: 'text' }>,page.style?.fontFamily??style.fontFamily)) diagnostics.push({ code: 'text-box-overflow', blockId: page.blockId, pageNumber:page.number, elementId:e.id, message: '特殊ページのテキストが枠に収まりません。原文は保持されています。文字サイズ・枠の大きさ・内容を確認してください。' });
  }
  for (const page of result.pages) if (page.kind === 'flow') for (const element of page.elements ?? []) if (element.kind === 'text' && textBoxOverflows(element as Extract<PageElement, { kind: 'text' }>,page.style?.fontFamily??style.fontFamily)) diagnostics.push({ code: 'text-box-overflow', ...(element.blockId ? { blockId: element.blockId } : {}), pageNumber: page.number, elementId: element.id, message: '図の説明が予約した枠に収まりません。文字サイズや内容を確認してください。' });
  let previousSection: string | undefined;
  const pageSections = result.pages.map(page => {
    const sectionId = sectionByBlock.get(page.kind === 'flow' ? page.lines[0]?.blockId ?? page.elements?.[0]?.blockId ?? '' : page.blockId) ?? previousSection;
    if (sectionId) { previousSection = sectionId; if (!firstPages.has(sectionId)) firstPages.set(sectionId, page.number); }
    return sectionId;
  });
  const sortedElements = [...project.runningElements].sort((a, b) => scopePriority(a.scope) - scopePriority(b.scope));
  const pages = result.pages.map((page, at) => {
    const sectionId = pageSections[at], section = sections.get(sectionId ?? ''), chapter = section?.children.find(b => b.id === section.headingId), elements = new Map<string, ResolvedRunningElement>();
    const pageBlockId = page.kind === 'flow' ? page.lines[0]?.blockId ?? page.elements?.[0]?.blockId : page.blockId;
    const props=blockPages.get(pageBlockId??'')??{},resolvedStyle=page.style??style;
    let hiddenHeads=props.showHeads===false||!!page.hideHeads,visibleFolio=props.showFolio!==false&&page.folioVisible!==false;
    for(const r of project.pageOverrides??[])if(r.pages.includes(page.number)){if(r.hideHeads!==undefined)hiddenHeads=r.hideHeads;if(r.folio!==undefined)visibleFolio=r.folio;}
    const ids=page.kind==='flow'?[...page.lines.map(l=>l.blockId),...(page.elements??[]).flatMap(e=>e.blockId?[e.blockId]:[])]:[page.blockId];
    const onPage = (scope: Scope) => ids.some(id=>matches(scope,id,sectionByBlock.get(id),page.number));
    for (const e of sortedElements) {
      if (hiddenHeads || !exists(e.scope) || !onPage(e.scope) || e.side !== 'both' && (page.number % 2 === 1) !== (e.side === 'odd') || e.hideOnSectionFirst && firstPages.get(sectionId ?? '') === page.number) continue;
      validateRunningElement(e,resolvedStyle);
      const text = e.content.kind === 'text' ? e.content.text : e.content.kind === 'title' ? tree.title : e.content.kind === 'author' ? tree.author : e.content.kind === 'chapter' ? chapter?.kind === 'heading' ? chapter.inlines.map(i => i.kind === 'text' ? i.text : i.base).join('') : '' : e.content.kind === 'heading' ? page.heading ?? '' : String(folioNumber(style.folio, page.number) ?? page.number);
      const location = `${e.position.split('-')[0]}-${decorationSide(style.pageLayout, page.number, e.position, style.binding)}`;
      elements.set(location, { id: e.id, text, position: e.position, ...(e.fontFamily?{fontFamily:e.fontFamily}:{}), fontPt: e.fontPt, insetMm: e.insetMm });
    }
    for (const element of elements.values()) {
      const side = decorationSide(style.pageLayout, page.number, element.position, style.binding), f = style.folio;
      if (visibleFolio && f && folioNumber(f, page.number) !== null && element.position.split('-')[0] === f.position.split('-')[0] && side === decorationSide(style.pageLayout, page.number, f.position, style.binding)) throw new Error('柱とノンブルが同じ位置にあります。配置を変更してください。');
      if (element.position.startsWith('top-') && headsForPage(style, page.number).some(h => decorationSide(style.pageLayout, page.number, h.position, style.binding) === side)) throw new Error('既存の柱と章の柱が同じ位置にあります。どちらかの配置を変更してください。');
    }
    const decorated = { ...page, style:resolvedStyle, ...(sectionId ? { sectionId } : {}), runningElements: [...elements.values()],...(hiddenHeads?{hideHeads:true}:{}),...(!visibleFolio?{folioVisible:false}:{}) };
    for (const rule of project.pageOverrides ?? []) if (rule.pages.includes(page.number)) {
      if (rule.folio !== undefined) decorated.folioVisible = rule.folio;
      if (rule.hideHeads !== undefined) decorated.hideHeads = rule.hideHeads;
      if (rule.paperColor !== undefined) decorated.paperColor = rule.paperColor;
    }
    return decorated;
  });
  for (const rule of project.pageOverrides ?? []) if (rule.pages.some(n => n > pages.length)) diagnostics.push({ code: 'page-override-orphan', message: '存在しない通しページを含む例外があります。指定は保持しています。' });
  const finished = finishBookPages({ ...project, styles: catalog, style }, pages);
  const finalTocParts = new Map<string, number>();
  for (const page of finished) if (page.kind === 'structured') {
    const definition = project.specialPages?.find(p => p.id === page.pageId);
    if (definition?.role === 'toc') {
      const part = finalTocParts.get(page.pageId) ?? 0; finalTocParts.set(page.pageId, part + 1);
      page.elements = templatePages(definition, page.style ?? style, tocEntries(project, definition, finished))[part]!;
    }
  }
  return { pages: finished, diagnostics: [...diagnostics, ...result.diagnostics] };
}
