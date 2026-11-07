import { Component, ElementRef, Input, OnChanges, SimpleChanges, viewChild, inject, signal } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { movieImageUrl, personImageUrl } from '../core/media.util';
import { MediaService } from '../data/media.service';

@Component({
  selector: 'app-media-image',
  standalone: true,
  host: {
    '[class.is-hidden]': '!hostVisible()',
    '[class.person-kind]': 'kind === "person"',
    '[class.movie-kind]': 'kind === "movie"',
  },
  template: `
    <div
      class="media-card"
      [class.editable]="canEdit()"
      [class.empty]="!hasImage()"
      [class.dragover]="dragOver()"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <button
        type="button"
        class="media-frame"
        [class.movie]="kind === 'movie'"
        [class.person]="kind === 'person'"
        [class.editable]="canEdit()"
        [class.empty]="!hasImage()"
        [disabled]="canEdit() && uploading()"
        [attr.aria-label]="canEdit() ? (hasImage() ? 'Vaihda kuva' : 'Lisää kuva') : alt"
        (click)="openPicker()"
      >
        @if (hasImage()) {
          <img [src]="displayUrl()" [alt]="alt" (error)="hasImage.set(false)" />
        } @else if (canEdit()) {
          <span class="placeholder">
            <span class="ph-hint">Klikkaa tai raahaa kuva tähän</span>
          </span>
        } @else if (showEmpty) {
          <span class="placeholder empty-frame" aria-hidden="true"></span>
        }
        @if (canEdit() && hasImage()) {
          <span class="hover-cue" aria-hidden="true">Vaihda kuva</span>
        }
        @if (uploading()) {
          <span class="busy">Ladataan…</span>
        }
      </button>

      @if (canEdit() && (imageSearchHref() || entityId > 0)) {
        <div class="media-toolbar">
          @if (imageSearchHref()) {
            <a class="find-link" [href]="imageSearchHref()!" target="_blank" rel="noopener noreferrer">
              Etsi kuva
            </a>
          }
          @if (entityId > 0) {
            <span class="entity-id" title="Tietueen tunniste">#{{ entityId }}</span>
          }
        </div>
      }
    </div>

    <input
      #fileInput
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      hidden
      (change)="onFileSelected($event)"
    />
    @if (error()) {
      <p class="media-error">{{ error() }}</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.35rem;
      width: min(300px, 100%);
      max-width: 100%;
      flex: 0 1 300px;
      box-sizing: border-box;
    }

    :host.is-hidden {
      display: none;
    }

    .media-card {
      display: grid;
      gap: 0.45rem;
      width: 100%;
    }

    .media-card.dragover .media-frame {
      border-color: #1f4b7a;
      box-shadow: 0 0 0 3px rgba(31, 75, 122, 0.22);
    }

    .media-frame {
      position: relative;
      width: 100%;
      margin: 0;
      padding: 0;
      border: 1px solid #d0d8e0;
      border-radius: 8px;
      background: #e8edf2;
      overflow: hidden;
      cursor: default;
      color: inherit;
      font: inherit;
    }

    .media-frame.movie {
      aspect-ratio: 2 / 3;
    }

    .media-frame.person {
      aspect-ratio: 3 / 4;
    }

    .media-frame.editable:not(:disabled) {
      cursor: pointer;
    }

    .media-frame.editable:not(:disabled):hover {
      border-color: #1f4b7a;
      box-shadow: 0 0 0 2px rgba(31, 75, 122, 0.18);
    }

    .media-frame.empty {
      display: grid;
      place-items: center;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.15)),
        repeating-linear-gradient(-45deg, #eef2f6, #eef2f6 8px, #e5ebf1 8px, #e5ebf1 16px);
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .placeholder {
      display: grid;
      gap: 0.35rem;
      justify-items: center;
      padding: 1rem;
      text-align: center;
      color: #5c6773;
    }

    .ph-title {
      font-size: 1rem;
      font-weight: 650;
      color: #1f4b7a;
    }

    .ph-hint {
      font-size: 1rem;
      line-height: 1.35;
      max-width: 12rem;
    }

    .hover-cue {
      position: absolute;
      inset: auto 0 0;
      padding: 0.55rem;
      background: linear-gradient(180deg, transparent, rgba(15, 23, 32, 0.72));
      color: #fff;
      font-size: 1rem;
      font-weight: 650;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .media-frame.editable:not(:disabled):hover .hover-cue {
      opacity: 1;
    }

    .busy {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background: rgba(255, 255, 255, 0.72);
      font-size: 1rem;
      font-weight: 650;
    }

    .media-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem 0.75rem;
    }

    .tool-btn {
      margin: 0;
      padding: 0.4rem 0.7rem;
      border: 1px solid #c5d0dc;
      border-radius: 6px;
      background: #e8eef4;
      color: #1f4b7a;
      font: inherit;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }

    .tool-btn:hover:not(:disabled) {
      background: #dce6f0;
    }

    .tool-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .find-link {
      color: #1f4b7a;
      font-size: 1rem;
      font-weight: 400;
      text-decoration: none;
    }

    .find-link:hover {
      color: #163a5f;
      text-decoration: none;
    }

    .entity-id {
      margin-left: auto;
      color: #6a7582;
      font-size: 1rem;
      font-variant-numeric: tabular-nums;
    }

    .media-error {
      margin: 0;
      color: #a40000;
      font-size: 1rem;
    }

    :host.person-kind .media-card {
      padding: 0.55rem;
      border: 1px solid #e2e8ef;
      border-radius: 12px;
      background: linear-gradient(180deg, #fbfcfd, #f3f6f9);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset;
    }

    :host.person-kind .media-frame {
      width: 100%;
      border-radius: 10px;
    }

    :host.person-kind .media-card {
      width: 100%;
      max-width: 300px;
    }

    @media (max-width: 640px) {
      :host {
        width: 100%;
        max-width: none;
        flex: 1 1 auto;
      }

      :host.person-kind .media-card {
        max-width: none;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: none;
        box-shadow: none;
      }

      :host.person-kind .media-frame,
      :host.movie-kind .media-frame {
        border-radius: 0;
        border-left: 0;
        border-right: 0;
      }
    }
  `,
})
export class MediaImageComponent implements OnChanges {
  @Input({ required: true }) kind!: 'movie' | 'person';
  @Input({ required: true }) entityId!: number;
  @Input() alt = '';
  @Input() editable = false;
  /** Keep an empty frame visible when there is no image (e.g. list preview). */
  @Input() showEmpty = false;
  /** Prebuilt Google Images query string (unencoded). When set, shows Etsi kuva. */
  @Input() imageSearchQuery = '';

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly auth = inject(AuthService);
  private readonly media = inject(MediaService);

  readonly hasImage = signal(false);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly cacheBust = signal(0);
  readonly dragOver = signal(false);

  canEdit(): boolean {
    return this.editable && this.auth.isSuperUser() && this.entityId > 0;
  }

  /** Hide empty frame when there is no image and upload is not available. */
  hostVisible(): boolean {
    return this.hasImage() || this.canEdit() || this.showEmpty;
  }

  displayUrl(): string {
    const base = this.kind === 'movie' ? movieImageUrl(this.entityId) : personImageUrl(this.entityId);
    const t = this.cacheBust();
    return t ? `${base}?t=${t}` : base;
  }

  imageSearchHref(): string | null {
    const q = this.imageSearchQuery.trim();
    if (!q || !this.canEdit()) {
      return null;
    }
    const params = new URLSearchParams();
    if (this.kind === 'movie') {
      params.set('movieid', String(this.entityId));
      params.set('q', q);
      params.set('tbm', 'isch');
      params.set('tbs', 'isz:m');
    } else {
      params.set('personid', String(this.entityId));
      params.set('q', `"${q}"`);
      params.set('tbm', 'isch');
      params.set('tbs', 'isz:m,itp:face');
    }
    return `https://www.google.fi/search?${params.toString()}`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['entityId'] || changes['kind']) {
      this.error.set(null);
      this.cacheBust.set(0);
      this.hasImage.set(this.entityId > 0);
    }
  }

  openPicker(): void {
    if (!this.canEdit() || this.uploading()) {
      return;
    }
    this.fileInput()?.nativeElement.click();
  }

  onDragOver(ev: DragEvent): void {
    if (!this.canEdit() || this.uploading()) {
      return;
    }
    ev.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
  }

  async onDrop(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    this.dragOver.set(false);
    if (!this.canEdit() || this.uploading()) {
      return;
    }
    const file = ev.dataTransfer?.files?.[0];
    if (file) {
      await this.upload(file);
    }
  }

  async onFileSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    await this.upload(file);
  }

  private async upload(file: File): Promise<void> {
    if (!this.canEdit()) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.error.set('Valitse kuvatiedosto.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.error.set('Kuva on liian suuri (max 8 Mt).');
      return;
    }

    this.uploading.set(true);
    this.error.set(null);
    try {
      await this.media.uploadImage(this.kind, this.entityId, file);
      this.cacheBust.set(Date.now());
      this.hasImage.set(true);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Kuvan lataus epäonnistui.');
    } finally {
      this.uploading.set(false);
    }
  }
}
