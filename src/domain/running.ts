import type { BookStyle } from './contracts.js';
import type { RunningElement } from './model.js';
import { DECORATION_POSITIONS, finite } from './style.js';
import { validateScope } from './scope.js';
import { identifier, object, textValue } from './validation.js';
import { fontDefinition } from './fonts.js';

export function validateRunningElement(value: unknown, style: BookStyle): asserts value is RunningElement {
  object(value, ['id', 'scope', 'content', 'position', 'side', 'fontFamily', 'fontPt', 'insetMm', 'hideOnSectionFirst'], '柱'); identifier(value.id); validateScope(value.scope);
  if (value.fontFamily !== undefined) fontDefinition(String(value.fontFamily));
  object(value.content, ['kind', 'text'], '柱の内容');
  if (value.content.kind === 'text') textValue(value.content.text, 100, '柱の文字');
  else { object(value.content, ['kind'], '柱の内容'); if (!['title', 'author', 'chapter', 'heading', 'pageNumber'].includes(value.content.kind as string)) throw new Error('未対応の柱の内容です。'); }
  if (!DECORATION_POSITIONS.includes(value.position as RunningElement['position']) || !['both', 'odd', 'even'].includes(value.side as string) || typeof value.hideOnSectionFirst !== 'boolean') throw new Error('柱の表示設定を確認してください。');
  const size = finite(value.fontPt, '柱の大きさ', 5, 12) * 25.4 / 72, inset = finite(value.insetMm, '柱の端からの距離', 3, 20), top = (value.position as string).startsWith('top-');
  if (top ? inset < size || inset + size * .3 > style.margins.topMm : inset + size > style.margins.bottomMm) throw new Error('柱が本文の余白と重なります。余白・距離・大きさを調整してください。');
}
