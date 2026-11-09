import { Component, HostListener, OnDestroy, effect, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../core/auth.service';
import { formatAppDate, parseAppDateTime } from '../core/datetime.util';
import { errorMessage } from '../core/error.util';
import {
  ageRatingImageSrc,
  ageRatingLabel,
  formatRuntimeMinutes,
  resolveNtscMinutes,
  roleSingularLabel,
  swapNames,
  titleWithYear,
} from '../core/format.util';
import { AppDateTime, LookupRow } from '../core/models';
import { LookupService } from '../data/lookup.service';
import { MovieDetails, MovieService } from '../data/movie.service';
import { OwnershipService } from '../data/ownership.service';
import { PersonDetails, PersonService } from '../data/person.service';
import { UserLinkService } from '../data/user-link.service';
import { MediaImageComponent } from './media-image.component';
import { ListPreviewItem, ListPreviewService } from './list-preview.service';

type PreviewReview = {
  UserId: number;
  ScoreId: number | null;
  Text: string | null;
  Name: string;
  Formats: string;
};

@Component({
  selector: 'app-list-preview',
  standalone: true,
  imports: [RouterLink, MediaImageComponent],
  template: `
    @if (preview.open()) {
      <div class="lp-backdrop" (click)="preview.close()" role="presentation">
        <div
          class="lp-panel"
          (click)="$event.stopPropagation()"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="heading()"
        >
          <div class="lp-toolbar">
            @if (canEdit()) {
              <button type="button" class="ghost lp-edit desktop-only" (click)="openEdit()">
                Muokkaa
              </button>
            } @else {
              <span></span>
            }
            <button type="button" class="lp-close" (click)="preview.close()" aria-label="Sulje">
              ×
            </button>
          </div>

          <div class="lp-frame">
            @if (loading()) {
              <div class="page-loading page-loading-inline" aria-live="polite">
                <div class="spinner" aria-hidden="true"></div>
                <p>Ladataan…</p>
              </div>
            } @else if (error()) {
              <p class="lp-error">{{ error() }}</p>
            } @else if (movie()) {
              <div class="lp-layout">
                <app-media-image
                  kind="movie"
                  [entityId]="movie()!.movie.Id"
                  [alt]="movie()!.movie.Title"
                  [editable]="false"
                  [showEmpty]="true"
                />
                <div class="lp-main">
                  <h2>
                    <a [routerLink]="['/movie', movie()!.movie.Id]" (click)="preview.close()">
                      {{ movieHeadingTitle(movie()!) }}
                      @if (movieHeadingVersion(movie()!); as ver) {
                        – <span class="version-name">{{ ver }}</span>
                      }
                    </a>
                    @if (ageLabel(movie()!.movie.Age)) {
                      @if (ageImageSrc(movie()!.movie.Age); as ageSrc) {
                        <img class="lp-age-image" [src]="ageSrc" [alt]="ageLabel(movie()!.movie.Age)" />
                      } @else {
                        <span class="lp-age-badge">{{ ageLabel(movie()!.movie.Age) }}</span>
                      }
                    }
                  </h2>
                  @if (avgScore() || movieDetailMeta(movie()!).length) {
                    <div class="lp-meta-row">
                      @if (avgScore(); as avg) {
                        <span class="lp-score-star" [attr.title]="'Keskiarvo ' + avg">
                          <span class="lp-score-star-glyph" aria-hidden="true">★</span>
                          <span class="lp-score-star-value">{{ avg }}</span>
                        </span>
                      }
                      @if (movieDetailMeta(movie()!).length) {
                        <div class="lp-meta-chips">
                          @for (chip of movieDetailMeta(movie()!); track chip; let last = $last) {
                            <span>{{ chip }}</span
                            >@if (!last) {
                              <span class="lp-meta-sep"> · </span>
                            }
                          }
                        </div>
                      }
                    </div>
                  }
                  @for (roleName of movieRoleNames(); track roleName) {
                    <div class="lp-role-block">
                      <p class="lp-role-label">{{ roleName }}</p>
                      <p class="lp-people">
                        @for (
                          r of movieRolesByType(roleName);
                          track r.PersonId + '-' + r.Sequence;
                          let last = $last
                        ) {
                          <a
                            [routerLink]="['/person', r.PersonId]"
                            (click)="preview.close()"
                            >{{ swapNames(r.Name) }}</a
                          >@if (!last) {
                            <span>, </span>
                          }
                        }
                      </p>
                    </div>
                  }
                  @if (reviews().length) {
                    <section class="lp-reviews">
                      <h3>Arvostelut</h3>
                      <ul class="lp-reviews-list">
                        @for (r of reviews(); track r.UserId) {
                          <li class="lp-review-item">
                            <div class="lp-review-head">
                              <div class="lp-review-who">
                                <span class="lp-review-name">{{ r.Name }}</span>
                                @if (r.Formats) {
                                  <span class="lp-review-formats">{{ r.Formats }}</span>
                                }
                              </div>
                              <span class="lp-review-score">
                                @if (reviewScoreDisplay(r.ScoreId); as score) {
                                  <span class="lp-score-star lp-score-star-sm" [attr.title]="'Arvosana ' + score">
                                    <span class="lp-score-star-glyph" aria-hidden="true">★</span>
                                    <span class="lp-score-star-value">{{ score }}</span>
                                  </span>
                                }
                              </span>
                            </div>
                            @if (r.Text) {
                              <div class="lp-review-bubble">
                                <div class="lp-review-text" [innerHTML]="r.Text"></div>
                              </div>
                            }
                          </li>
                        }
                      </ul>
                    </section>
                  }
                </div>
              </div>
            } @else if (person()) {
              <div
                class="lp-layout"
                [class.gender-male]="person()!.person.Gender === 0"
                [class.gender-female]="person()!.person.Gender === 1"
              >
                <a
                  class="lp-image-link"
                  [routerLink]="['/person', person()!.person.Id]"
                  (click)="preview.close()"
                  [attr.aria-label]="swapNames(person()!.person.Name)"
                >
                  <app-media-image
                    kind="person"
                    [entityId]="person()!.person.Id"
                    [alt]="swapNames(person()!.person.Name)"
                    [editable]="false"
                    [showEmpty]="true"
                  />
                </a>
                <div class="lp-main">
                  <h2>
                    <a [routerLink]="['/person', person()!.person.Id]" (click)="preview.close()">
                      {{ swapNames(person()!.person.Name) }}
                    </a>
                  </h2>
                  @if (person()!.person.RealName) {
                    <p class="lp-meta">{{ swapNames(person()!.person.RealName) }}</p>
                  }
                  @if (personLife(person()!); as life) {
                    <p class="lp-meta">{{ life }}</p>
                  }
                  @if (person()!.filmography.length) {
                    <section class="lp-filmography">
                      <h3>Elokuvatuotanto ({{ person()!.filmography.length }})</h3>
                      <ul>
                        @for (f of person()!.filmography; track f.MovieId) {
                          <li>
                            <a
                              [routerLink]="['/movie', f.MovieId]"
                              (click)="preview.close()"
                            >
                              {{ f.Title }}{{ f.Year ? ' (' + f.Year + ')' : '' }}
                            </a>
                            @if (personOwnershipLabel(f.MovieId); as own) {
                              <span class="ownership-mark">{{ own }}</span>
                            }
                            @if (f.Roles.length) {
                              <span class="lp-film-roles">{{ f.Roles.join(', ') }}</span>
                            }
                          </li>
                        }
                      </ul>
                    </section>
                  }
                </div>
              </div>
            }
          </div>

          <div class="lp-nav">
            <button
              type="button"
              class="lp-arrow"
              (click)="preview.prev()"
              [disabled]="preview.items().length < 2"
              aria-label="Edellinen"
            >
              ←
            </button>
            <span class="lp-count" aria-live="polite">
              {{ preview.index() + 1 }} / {{ preview.items().length }}
            </span>
            <button
              type="button"
              class="lp-arrow"
              (click)="preview.next()"
              [disabled]="preview.items().length < 2"
              aria-label="Seuraava"
            >
              →
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .lp-backdrop {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      place-items: center;
      padding: 1rem;
      background: rgba(15, 23, 32, 0.58);
    }

    .lp-panel {
      width: min(44rem, 100%);
      max-height: calc(100vh - 2rem);
      max-height: calc(100svh - 2rem);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 0.55rem;
      padding: 0.75rem 1rem 0.85rem;
      border-radius: 12px;
      background: #f7f9fc;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
      box-sizing: border-box;
      overflow: hidden;
    }

    .lp-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      min-height: 2rem;
    }

    .lp-edit {
      padding: 0.35rem 0.7rem;
      border: 1px solid #c5d0dc;
      border-radius: 4px;
      background: #e8eef4;
      color: #1f4b7a;
      font: inherit;
      cursor: pointer;
    }

    .lp-edit:hover {
      background: #dce6f0;
    }

    .lp-close {
      display: inline-grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      margin: 0 0 0 auto;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #1f4b7a;
      font-size: 1.55rem;
      line-height: 1;
      cursor: pointer;
    }

    .lp-close:hover {
      background: rgba(31, 75, 122, 0.12);
    }

    .lp-frame {
      min-height: 0;
      min-width: 0;
      overflow-x: hidden;
      overflow-y: auto;
      padding: 0.85rem;
      border: 2px solid #c5d0dc;
      border-radius: 10px;
      background: #fff;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.8);
    }

    .lp-layout {
      display: grid;
      grid-template-columns: minmax(0, 160px) minmax(0, 1fr);
      gap: 1rem 1.15rem;
      align-items: start;
    }

    .lp-layout.gender-male {
      background: #e7f1fa;
      margin: -0.85rem;
      padding: 0.85rem;
      border-radius: 8px;
    }

    .lp-layout.gender-female {
      background: #fce8ef;
      margin: -0.85rem;
      padding: 0.85rem;
      border-radius: 8px;
    }

    .lp-image-link {
      display: block;
      color: inherit;
      text-decoration: none;
      min-width: 0;
    }

    .lp-main {
      display: grid;
      gap: 0.35rem;
      min-width: 0;
      align-content: start;
    }

    h2 {
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 0.55rem;
      font-size: 1.2rem;
      font-weight: 700;
      line-height: 1.3;
      color: #111;
    }

    h2 a {
      color: inherit;
      font-weight: 700;
      text-decoration: none;
    }

    h2 a:hover {
      color: #1f4b7a;
    }

    .version-name {
      color: #8b4513;
      font-weight: 700;
    }

    .lp-age-image {
      height: 1.35rem;
      width: auto;
      display: block;
    }

    .lp-age-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      background: #1f4b7a;
      color: #fff;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .lp-meta-row {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 0.55rem 0.75rem;
      margin: 0.15rem 0 0;
    }

    .lp-meta-row > .lp-score-star {
      align-self: center;
      order: 0;
    }

    .lp-meta-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.1rem 0;
      margin: 0;
      min-width: 0;
      flex: 1 1 auto;
      color: #111;
      line-height: 1.4;
      order: 1;
    }

    .lp-meta-sep {
      opacity: 0.65;
    }

    .lp-reviews {
      margin-top: 0.55rem;
      display: grid;
      gap: 0.45rem;
      min-width: 0;
      max-width: 100%;
    }

    .lp-reviews > h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: #111;
    }

    .lp-reviews-list {
      list-style: none;
      margin: 0;
      padding: 0 0 0 4px;
      display: grid;
      gap: 0;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }

    .lp-review-item {
      display: grid;
      gap: 0;
      min-width: 0;
      max-width: 100%;
    }

    .lp-review-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem 0.65rem;
      min-width: 0;
    }

    .lp-review-who {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem;
      min-width: 0;
    }

    .lp-review-name {
      font-weight: 400;
      color: #111;
      line-height: 1.15;
      white-space: nowrap;
    }

    .lp-review-formats {
      color: #1b7a3d;
      font-size: 0.88em;
      font-weight: 700;
      line-height: 1.15;
      white-space: nowrap;
    }

    .lp-review-score {
      display: grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
    }

    .lp-review-bubble {
      --lp-review-bubble-bg: #dbe7f2;
      position: relative;
      margin: 0.15rem 0 0.35rem;
      padding: 0.65rem 0.8rem;
      border: 1px solid #b7c9da;
      border-radius: 10px;
      background: var(--lp-review-bubble-bg);
      color: #111;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }

    .lp-review-bubble::before,
    .lp-review-bubble::after {
      content: '';
      position: absolute;
      left: 1rem;
      width: 0;
      height: 0;
      border-left: 0.45rem solid transparent;
      border-right: 0.45rem solid transparent;
    }

    .lp-review-bubble::before {
      top: -0.5rem;
      border-bottom: 0.5rem solid #b7c9da;
    }

    .lp-review-bubble::after {
      top: -0.38rem;
      border-bottom: 0.45rem solid var(--lp-review-bubble-bg);
    }

    .lp-review-text {
      flex: 1 1 auto;
      min-width: 0;
      font-weight: 400;
      line-height: 1.4;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .lp-review-text :is(p, div, span, br, b, strong) {
      max-width: 100%;
      font-weight: 400;
    }

    .lp-score-star-sm {
      width: 2.5rem;
      height: 2.5rem;
    }

    .lp-review-score .lp-score-star-sm {
      width: 100%;
      height: 100%;
    }

    .lp-score-star-sm .lp-score-star-glyph {
      font-size: 2.5rem;
    }

    .lp-score-star-sm .lp-score-star-value {
      font-size: 0.92rem;
      margin-top: 0.12rem;
    }

    .lp-score-star {
      position: relative;
      flex: 0 0 auto;
      display: inline-grid;
      place-items: center;
      width: 2.85rem;
      height: 2.85rem;
      line-height: 1;
    }

    .lp-score-star-glyph {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font-size: 2.85rem;
      color: #ffd000;
      text-shadow: 0 0 1px #b8860b;
      pointer-events: none;
    }

    .lp-score-star-value {
      position: relative;
      z-index: 1;
      font-size: 1rem;
      font-weight: 700;
      color: #1a1a1a;
      margin-top: 0.14rem;
    }

    .lp-meta {
      margin: 0;
      color: #111;
      line-height: 1.4;
    }

    .lp-roles {
      font-weight: 600;
      color: #1f4b7a;
    }

    .lp-role-block {
      display: grid;
      gap: 0.15rem;
      margin-top: 0.35rem;
    }

    .lp-role-label {
      margin: 0;
      font-weight: 700;
      color: #111;
    }

    .lp-people {
      margin: 0;
      padding-left: 4px;
      line-height: 1.4;
      color: #111;
    }

    .lp-people a {
      color: #1f4b7a;
      text-decoration: none;
    }

    .lp-people a:hover {
      color: #163a5f;
    }

    .lp-error {
      margin: 0;
      color: #a40000;
    }

    .lp-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      flex: 0 0 auto;
      padding-bottom: max(0.15rem, env(safe-area-inset-bottom, 0px));
    }

    .lp-arrow {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.4rem;
      height: 2rem;
      margin: 0;
      padding: 0;
      border: 1px solid #c5d0dc;
      border-radius: 6px;
      background: #e8eef4;
      color: #1f4b7a;
      font-size: 1.15rem;
      line-height: 1;
      cursor: pointer;
    }

    .lp-filmography {
      margin-top: 0.55rem;
    }

    .lp-filmography h3 {
      margin: 0 0 0.35rem;
      font-size: 0.95rem;
      font-weight: 700;
      color: #152536;
    }

    .lp-filmography ul {
      list-style: none;
      margin: 0;
      padding: 0 0 0 4px;
      display: grid;
      gap: 0.2rem;
    }

    .lp-filmography li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.25rem 0.45rem;
      font-size: 0.95rem;
    }

    .lp-film-roles {
      margin-left: auto;
      color: #66788c;
      font-size: 0.88rem;
      text-align: right;
    }

    .lp-arrow:hover:not(:disabled) {
      background: #dce6f0;
    }

    .lp-arrow:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .lp-count {
      min-width: 4.5rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
      color: #1f4b7a;
      font-weight: 600;
    }

    @media (max-width: 640px) {
      .lp-backdrop {
        padding: 0.5rem;
        padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));
        align-items: stretch;
      }

      .lp-panel {
        width: 100%;
        height: calc(100svh - 1rem);
        max-height: calc(100svh - 1rem);
        padding: 0.65rem 0.75rem 0.65rem;
        border-radius: 10px;
      }

      .lp-layout {
        grid-template-columns: 1fr;
      }

      .lp-layout > app-media-image,
      .lp-image-link {
        display: none !important;
      }
    }
  `,
})
export class ListPreviewComponent implements OnDestroy {
  readonly preview = inject(ListPreviewService);
  readonly auth = inject(AuthService);
  private readonly movies = inject(MovieService);
  private readonly people = inject(PersonService);
  private readonly userLinks = inject(UserLinkService);
  private readonly ownershipApi = inject(OwnershipService);
  private readonly lookups = inject(LookupService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly movie = signal<MovieDetails | null>(null);
  readonly person = signal<PersonDetails | null>(null);
  readonly avgScore = signal<string | null>(null);
  readonly reviews = signal<PreviewReview[]>([]);
  readonly personOwnership = signal<Map<number, string[]>>(new Map());
  readonly swapNames = swapNames;

  private readonly movieCache = new Map<number, MovieDetails>();
  private readonly personCache = new Map<number, PersonDetails>();
  private readonly avgScoreCache = new Map<number, string | null>();
  private readonly reviewsCache = new Map<number, PreviewReview[]>();
  private readonly personOwnershipCache = new Map<number, Map<number, string[]>>();
  private scores: LookupRow[] = [];
  private scoresLoaded = false;
  private loadToken = 0;
  private readonly routerStartSub = this.router.events
    .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
    .subscribe(() => {
      if (this.preview.open()) {
        this.preview.close();
      }
    });

  private readonly routerEndSub = this.router.events
    .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
    .subscribe((e) => {
      if (!this.preview.isPaused() || this.isEditUrl(e.urlAfterRedirects)) {
        return;
      }
      this.movieCache.clear();
      this.personCache.clear();
      this.avgScoreCache.clear();
      this.reviewsCache.clear();
      this.personOwnershipCache.clear();
      this.preview.resume();
    });

  constructor() {
    effect(() => {
      if (!this.preview.open()) {
        return;
      }
      const item = this.preview.current();
      if (!item) {
        return;
      }
      void this.loadItem(item);
    });
  }

  ngOnDestroy(): void {
    this.routerStartSub.unsubscribe();
    this.routerEndSub.unsubscribe();
  }

  private isEditUrl(url: string): boolean {
    const path = url.split('?')[0];
    return (
      /\/movie\/\d+\/edit$/.test(path) ||
      /\/person\/\d+\/edit$/.test(path) ||
      path === '/movie/new' ||
      path === '/person/new'
    );
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (!this.preview.open()) {
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.preview.close();
      return;
    }
    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      this.preview.prev();
      return;
    }
    if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      this.preview.next();
    }
  }

  canEdit(): boolean {
    if (!this.auth.isSuperUser() || this.loading() || this.error()) {
      return false;
    }
    return !!(this.movie() || this.person());
  }

  reviewScoreDisplay(scoreId: number | null | undefined): string | null {
    if (scoreId == null || scoreId <= 0) {
      return null;
    }
    const row = this.scores.find((s) => s.Id === scoreId);
    if (!row) {
      return null;
    }
    const n = Number(row.Value);
    if (!Number.isFinite(n)) {
      return null;
    }
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  openEdit(): void {
    const returnUrl = this.router.url;
    const m = this.movie();
    if (m) {
      this.preview.pauseForEdit();
      void this.router.navigate(['/movie', m.movie.Id, 'edit'], {
        queryParams: { return: returnUrl },
      });
      return;
    }
    const p = this.person();
    if (p) {
      this.preview.pauseForEdit();
      void this.router.navigate(['/person', p.person.Id, 'edit'], {
        queryParams: { return: returnUrl },
      });
    }
  }

  heading(): string {
    const m = this.movie();
    if (m) {
      return this.movieHeading(m);
    }
    const p = this.person();
    if (p) {
      return swapNames(p.person.Name);
    }
    return 'Esikatselu';
  }

  movieHeading(d: MovieDetails): string {
    const title = this.movieHeadingTitle(d);
    const ver = this.movieHeadingVersion(d);
    return ver ? `${title} – ${ver}` : title;
  }

  movieHeadingTitle(d: MovieDetails): string {
    return titleWithYear(
      d.movie.Title,
      d.movie.TitleLanguageId,
      d.movie.Year,
      d.movie.DistributionId
    );
  }

  movieHeadingVersion(d: MovieDetails): string {
    const v = d.version?.trim() ?? '';
    return !v || v === '-' ? '' : v;
  }

  readonly ageLabel = ageRatingLabel;
  readonly ageImageSrc = ageRatingImageSrc;

  /** Same basic fields as movie-detail meta chips (without average score). */
  movieDetailMeta(d: MovieDetails): string[] {
    const chips: string[] = [];
    if (d.categories.length) {
      chips.push(d.categories.join(', '));
    }
    if (d.countries.length) {
      chips.push(d.countries.join(', '));
    }
    if (d.ratio && d.ratio !== '-') {
      chips.push(d.ratio);
    }
    if (d.sounds.length) {
      chips.push(d.sounds.join(', '));
    }
    const budget = Number(d.movie.Budget);
    if (Number.isFinite(budget) && budget > 0) {
      const money = Math.trunc(budget).toLocaleString('fi-FI');
      chips.push(d.currency && d.currency !== '-' ? `${money} ${d.currency}` : money);
    }
    const ntsc = resolveNtscMinutes(d.movie.Ntsc, d.movie.Pal);
    if (ntsc != null) {
      const runtime = formatRuntimeMinutes(ntsc);
      if (runtime) {
        chips.push(runtime);
      }
    }
    return chips;
  }

  movieRoleNames(): string[] {
    return [...new Set((this.movie()?.roles ?? []).map((r) => r.Role))];
  }

  movieRolesByType(roleName: string) {
    return (this.movie()?.roles ?? []).filter((r) => r.Role === roleName);
  }

  personOwnershipLabel(movieId: number): string {
    const labels = this.personOwnership().get(movieId);
    return labels?.length ? labels.join(', ') : '';
  }

  personRoles(): string {
    const fromItem = this.preview.current()?.roles?.filter((r) => !!r?.trim()) ?? [];
    if (fromItem.length) {
      return fromItem.join(', ');
    }
    const details = this.person();
    if (!details?.filmography.length) {
      return '';
    }
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const f of details.filmography) {
      for (const role of f.Roles) {
        const label = roleSingularLabel(role) || role.trim();
        if (!label || seen.has(label)) {
          continue;
        }
        seen.add(label);
        labels.push(label);
      }
    }
    return labels.join(', ');
  }

  personLife(d: PersonDetails): string {
    const birth = this.datePlace(d.person.BirthDate, d.birthCountry);
    const death = this.datePlace(d.person.DeathDate, d.deathCountry);
    if (death) {
      return [birth, death].filter(Boolean).join(' – ');
    }
    const age = this.livingAge(d);
    return [birth, age].filter(Boolean).join(' ');
  }

  private datePlace(
    dateValue: AppDateTime | string | null | undefined,
    place: string | null | undefined
  ): string {
    const raw = formatAppDate(dateValue);
    const date = raw ? raw.replace(/^0(\d)\./, '$1.').replace(/\.0(\d)\./, '.$1.') : '';
    const loc = (place ?? '').trim();
    return [date, loc].filter(Boolean).join(' ');
  }

  private livingAge(d: PersonDetails): string {
    const death = parseAppDateTime(d.person.DeathDate);
    if (death && death.year > 0) {
      return '';
    }
    const birth = parseAppDateTime(d.person.BirthDate);
    if (!birth?.year || birth.year <= 0) {
      return '';
    }
    let years = new Date().getFullYear() - birth.year;
    const fromMonth = birth.month > 0 ? birth.month : 1;
    const fromDay = birth.day > 0 ? birth.day : 1;
    const now = new Date();
    if (
      now.getMonth() + 1 < fromMonth ||
      (now.getMonth() + 1 === fromMonth && now.getDate() < fromDay)
    ) {
      years -= 1;
    }
    return years >= 0 ? `(${years}v)` : '';
  }

  private async loadItem(item: ListPreviewItem): Promise<void> {
    const token = ++this.loadToken;
    this.error.set(null);

    if (item.kind === 'movie') {
      const cached = this.movieCache.get(item.id);
      if (cached) {
        this.person.set(null);
        this.personOwnership.set(new Map());
        this.movie.set(cached);
        this.avgScore.set(this.avgScoreCache.get(item.id) ?? null);
        this.reviews.set(this.reviewsCache.get(item.id) ?? []);
        this.loading.set(false);
        if (!this.avgScoreCache.has(item.id) || !this.reviewsCache.has(item.id)) {
          void this.loadReviewsAndAvg(item.id, token);
        }
        return;
      }
      this.loading.set(true);
      this.movie.set(null);
      this.person.set(null);
      this.personOwnership.set(new Map());
      this.avgScore.set(null);
      this.reviews.set([]);
      try {
        const details = await this.movies.getDetails(item.id);
        if (token !== this.loadToken) {
          return;
        }
        if (!details) {
          this.error.set('Elokuvaa ei löytynyt.');
          return;
        }
        this.movieCache.set(item.id, details);
        this.movie.set(details);
        void this.loadReviewsAndAvg(item.id, token);
      } catch (e: unknown) {
        if (token !== this.loadToken) {
          return;
        }
        this.error.set(errorMessage(e));
      } finally {
        if (token === this.loadToken) {
          this.loading.set(false);
        }
      }
      return;
    }

    const cached = this.personCache.get(item.id);
    if (cached) {
      this.movie.set(null);
      this.person.set(cached);
      this.avgScore.set(null);
      this.reviews.set([]);
      this.personOwnership.set(this.personOwnershipCache.get(item.id) ?? new Map());
      this.loading.set(false);
      if (!this.personOwnershipCache.has(item.id)) {
        void this.loadPersonOwnership(item.id, cached, token);
      }
      return;
    }
    this.loading.set(true);
    this.movie.set(null);
    this.person.set(null);
    this.avgScore.set(null);
    this.reviews.set([]);
    this.personOwnership.set(new Map());
    try {
      const details = await this.people.getDetails(item.id);
      if (token !== this.loadToken) {
        return;
      }
      if (!details) {
        this.error.set('Henkilöä ei löytynyt.');
        return;
      }
      this.personCache.set(item.id, details);
      this.person.set(details);
      void this.loadPersonOwnership(item.id, details, token);
    } catch (e: unknown) {
      if (token !== this.loadToken) {
        return;
      }
      this.error.set(errorMessage(e));
    } finally {
      if (token === this.loadToken) {
        this.loading.set(false);
      }
    }
  }

  private async loadPersonOwnership(
    personId: number,
    details: PersonDetails,
    token: number
  ): Promise<void> {
    const userId = this.auth.profile()?.Id ?? null;
    if (!userId || !details.filmography.length) {
      this.personOwnershipCache.set(personId, new Map());
      if (token === this.loadToken && this.preview.current()?.id === personId) {
        this.personOwnership.set(new Map());
      }
      return;
    }
    try {
      const map = await this.ownershipApi.formatLabelsForUserMovies(
        userId,
        details.filmography.map((f) => f.MovieId)
      );
      if (token !== this.loadToken) {
        return;
      }
      this.personOwnershipCache.set(personId, map);
      if (this.preview.current()?.kind === 'person' && this.preview.current()?.id === personId) {
        this.personOwnership.set(map);
      }
    } catch {
      if (token === this.loadToken) {
        this.personOwnershipCache.set(personId, new Map());
        this.personOwnership.set(new Map());
      }
    }
  }

  private async loadReviewsAndAvg(movieId: number, token: number): Promise<void> {
    try {
      if (!this.scoresLoaded) {
        this.scores = await this.lookups.get('Score');
        this.scoresLoaded = true;
      }
      const raw = await this.userLinks.listForMovie(movieId);
      if (token !== this.loadToken) {
        return;
      }
      const formatMap = await this.ownershipApi.formatLabelsByUserForMovie(
        movieId,
        raw.map((r) => r.UserId)
      );
      if (token !== this.loadToken) {
        return;
      }
      const reviews: PreviewReview[] = raw
        .filter((r) => (r.ScoreId != null && r.ScoreId > 0) || !!r.Text?.trim())
        .map((r) => ({
          ...r,
          Formats: formatMap.get(r.UserId) ?? r.Formats ?? '',
        }));
      const scored = reviews
        .map((r) => {
          if (r.ScoreId == null || r.ScoreId <= 0) {
            return null;
          }
          const row = this.scores.find((s) => s.Id === r.ScoreId);
          return row ? Number(row.Value) : null;
        })
        .filter((v): v is number => v != null && !Number.isNaN(v));
      const avg =
        scored.length > 0
          ? (Math.round((scored.reduce((sum, v) => sum + v, 0) / scored.length) * 10) / 10).toFixed(1)
          : null;
      this.avgScoreCache.set(movieId, avg);
      this.reviewsCache.set(movieId, reviews);
      if (this.preview.current()?.kind === 'movie' && this.preview.current()?.id === movieId) {
        this.avgScore.set(avg);
        this.reviews.set(reviews);
      }
    } catch {
      if (token === this.loadToken) {
        this.avgScoreCache.set(movieId, null);
        this.reviewsCache.set(movieId, []);
        this.avgScore.set(null);
        this.reviews.set([]);
      }
    }
  }
}
