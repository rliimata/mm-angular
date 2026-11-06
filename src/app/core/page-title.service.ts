import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';

@Injectable({ providedIn: 'root' })
export class PageTitleService {
  constructor(private readonly title: Title) {}

  set(label: string | null | undefined): void {
    const t = (label ?? '').trim();
    this.title.setTitle(t || 'Haku');
  }
}
