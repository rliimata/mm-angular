import { Directive, HostListener } from '@angular/core';

/**
 * Capitalize the first letter of the field and the first letter after .!?
 * (desktop browsers ignore HTML autocapitalize).
 */
@Directive({
  selector: 'input[appSentenceCase], textarea[appSentenceCase]',
  standalone: true,
})
export class SentenceCaseDirective {
  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement;
    const prev = el.value;
    const next = sentenceCapitalize(prev);
    if (next === prev) {
      return;
    }
    const start = el.selectionStart ?? next.length;
    const end = el.selectionEnd ?? next.length;
    el.value = next;
    try {
      el.setSelectionRange(start, end);
    } catch {
      // some input types reject setSelectionRange
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Uppercase first letter of text and after sentence-ending punctuation. */
export function sentenceCapitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value.replace(/(^|[.!?]\s+)(\p{L})/gu, (_m, lead: string, ch: string) => {
    return lead + ch.toLocaleUpperCase('fi-FI');
  });
}
