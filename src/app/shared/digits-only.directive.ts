import { Directive, HostListener } from '@angular/core';

/** Keeps only digits 0–9 in a text input. Works with ngModel / reactive forms. */
@Directive({
  selector: 'input[appDigitsOnly]',
  standalone: true,
})
export class DigitsOnlyDirective {
  @HostListener('beforeinput', ['$event'])
  onBeforeInput(event: InputEvent): void {
    if (event.inputType?.startsWith('delete') || event.inputType === 'historyUndo') {
      return;
    }
    const data = event.data ?? '';
    if (data && /\D/.test(data)) {
      event.preventDefault();
    }
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (/\D/.test(text)) {
      event.preventDefault();
      const input = event.target as HTMLInputElement;
      const digits = text.replace(/\D+/g, '');
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      const next = input.value.slice(0, start) + digits + input.value.slice(end);
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/\D+/g, '');
    if (cleaned !== input.value) {
      const pos = input.selectionStart ?? cleaned.length;
      input.value = cleaned;
      input.setSelectionRange(Math.min(pos - 1, cleaned.length), Math.min(pos - 1, cleaned.length));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}
