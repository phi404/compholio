import type { BookModel } from '../domain/model.js';
import type { CharacterProperties, ParagraphProperties } from '../domain/contracts.js';
import { inheritedStyle } from '../domain/styles.js';
import { setIconChoice } from './choices.js';
import { styleFields } from './style-fields.js';
import { el } from './dom.js';

/** These controls and the advanced catalog both edit the same named style records. */
export function typographyEditor(host: { book(): BookModel; change(book: BookModel): void }) {
  const parent = el('typography-editor'), choose = el<HTMLSelectElement>('typography-target'); let target = 'all';
  const entry = () => target === 'all' ? undefined : (['chapter', 'section', 'small-heading'].includes(target) ? host.book().styles.headings : host.book().styles.paragraphs).find(s => s.id === target)!;
  const character = (): CharacterProperties => {
    if (target === 'all') return host.book().styles.characters.find(s => s.id === 'text')!.properties;
    const p = entry()!, family = ['chapter', 'section', 'small-heading'].includes(target) ? host.book().styles.headings : host.book().styles.paragraphs;
    const id = inheritedStyle(family, p.id).characterStyleId ?? 'text';
    return id === `type-${target}` ? host.book().styles.characters.find(s => s.id === id)!.properties : {};
  };
  const updateCharacter = (properties: CharacterProperties) => {
    const book = host.book(), styles = structuredClone(book.styles);
    if (target === 'all') styles.characters.find(s => s.id === 'text')!.properties = properties;
    else {
      const family = ['chapter', 'section', 'small-heading'].includes(target) ? styles.headings : styles.paragraphs, p = family.find(s => s.id === target)!;
      const id = `type-${target}`, old = styles.characters.find(s => s.id === id);
      if (old) old.properties = properties;
      else styles.characters.push({ id, name: `${p.name}の文字`, basedOn: 'text', properties });
      p.characterStyleId = id;
    }
    host.change({ ...book, styles });
  };
  function render(): void {
    parent.replaceChildren(); el('basic-type-controls').hidden = target !== 'all';
    const fields = document.createElement('div'); fields.className = 'typography-fields'; parent.append(fields);
    styleFields(fields, 'type-character', 'character', character, updateCharacter, target === 'all' ? ['fontPt','fontFamily'] : []);
    if (target !== 'all') {
      const d = document.createElement('details'); d.className = 'style-details'; d.open = true; const summary = document.createElement('summary'); summary.textContent = '揃えと余白'; d.append(summary); parent.append(d);
      styleFields<ParagraphProperties>(d, 'type-paragraph', 'paragraph', () => entry()!.properties, properties => {
        const book = host.book(), styles = structuredClone(book.styles), family = ['chapter', 'section', 'small-heading'].includes(target) ? styles.headings : styles.paragraphs;
        family.find(s => s.id === target)!.properties = properties; host.change({ ...book, styles });
      });
    }
  }
  choose.addEventListener('change', () => { if (choose.value === 'context') return; target = choose.value; render(); });
  function sync(): void {
    for (const control of parent.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLFieldSetElement>('input, select, [data-choice-field]')) {
      if (control === document.activeElement) continue;
      const family = control.id.startsWith('type-character-') ? character() : entry()?.properties ?? {}, key = control.id.replace(/^type-(?:character|paragraph)-/u, ''); if (control instanceof HTMLFieldSetElement) { setIconChoice(control, (family as Record<string, unknown>)[key]); control.dataset.vertical = String(host.book().style.writingMode === 'vertical-rl'); } else control.value = String((family as Record<string, unknown>)[key] ?? '');
    }
  }
  render(); return { sync, open(value = 'all') { target = value; choose.value = value; render(); } };
}
