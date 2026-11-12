import { Directive, HostBinding, HostListener } from '@angular/core';

/**
 * Sentence-case text fields: first letter and after .!?
 * Also sets autocapitalize for mobile soft keyboards.
 */
@Directive({
  selector: 'input[appSentenceCase], textarea[appSentenceCase]',
  standalone: true,
})
export class SentenceCaseDirective {
  private applying = false;

  @HostBinding('attr.autocapitalize') readonly autocapitalize = 'sentences';
  @HostBinding('attr.autocorrect') readonly autocorrect = 'on';
  @HostBinding('attr.spellcheck') readonly spellcheck = 'true';

  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    if (this.applying) {
      return;
    }
    const el = event.target as HTMLInputElement | HTMLTextAreaElement;
    const prev = el.value;
    const next = sentenceCapitalize(prev);
    if (next === prev) {
      return;
    }
    const start = el.selectionStart ?? next.length;
    const end = el.selectionEnd ?? next.length;
    this.applying = true;
    el.value = next;
    try {
      el.setSelectionRange(start, end);
    } catch {
      // some input types reject setSelectionRange
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    this.applying = false;
  }

  @HostListener('blur', ['$event'])
  onBlur(event: Event): void {
    if (this.applying) {
      return;
    }
    const el = event.target as HTMLInputElement | HTMLTextAreaElement;
    const prev = el.value;
    const next = sentenceCapitalize(prev);
    if (next === prev) {
      return;
    }
    this.applying = true;
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    this.applying = false;
  }
}

/** Uppercase first letter of text and after sentence-ending punctuation. */
export function sentenceCapitalize(value: string): string {
  if (!value) {
    return value;
  }
  // Prefer Unicode letters; fall back for older mobile WebViews without \p{L}.
  try {
    return value.replace(/(^|[.!?]\s+)(\p{L})/gu, (_m, lead: string, ch: string) => {
      return lead + ch.toLocaleUpperCase('fi-FI');
    });
  } catch {
    return value.replace(/(^|[.!?]\s+)([A-Za-zÀ-ÖØ-öø-ÿÄÖÅäöå])/g, (_m, lead: string, ch: string) => {
      return lead + ch.toLocaleUpperCase('fi-FI');
    });
  }
}
