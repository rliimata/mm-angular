import { Injectable, signal } from '@angular/core';

export type ListPreviewKind = 'movie' | 'person';

export interface ListPreviewItem {
  kind: ListPreviewKind;
  id: number;
  /** Optional role labels for person items (e.g. credits on the current movie). */
  roles?: string[];
}

@Injectable({ providedIn: 'root' })
export class ListPreviewService {
  readonly open = signal(false);
  readonly items = signal<ListPreviewItem[]>([]);
  readonly index = signal(0);

  /** Hidden for edit, but list kept so cancel/save can reopen the same preview. */
  private paused = false;

  current(): ListPreviewItem | null {
    const items = this.items();
    const i = this.index();
    if (!items.length || i < 0 || i >= items.length) {
      return null;
    }
    return items[i];
  }

  isPaused(): boolean {
    return this.paused;
  }

  show(items: ListPreviewItem[], index = 0): void {
    const clean = items.filter((it) => it.id > 0);
    if (!clean.length) {
      return;
    }
    const i = Math.min(Math.max(0, index), clean.length - 1);
    this.items.set(clean);
    this.index.set(i);
    this.paused = false;
    this.open.set(true);
  }

  /** Leave preview for the edit page without discarding the browse list. */
  pauseForEdit(): void {
    this.open.set(false);
    this.paused = this.items().length > 0;
  }

  /** Reopen after returning from edit (Tallenna / Peruuta). */
  resume(): boolean {
    if (!this.paused || !this.items().length) {
      this.paused = false;
      return false;
    }
    this.paused = false;
    this.open.set(true);
    return true;
  }

  close(): void {
    this.open.set(false);
    this.items.set([]);
    this.index.set(0);
    this.paused = false;
  }

  prev(): void {
    const n = this.items().length;
    if (n < 2) {
      return;
    }
    this.index.update((i) => (i - 1 + n) % n);
  }

  next(): void {
    const n = this.items().length;
    if (n < 2) {
      return;
    }
    this.index.update((i) => (i + 1) % n);
  }

  /** Open preview unless the user is opening a new tab / middle-click. */
  fromClick(event: MouseEvent, items: ListPreviewItem[], index: number): void {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.show(items, index);
  }
}
