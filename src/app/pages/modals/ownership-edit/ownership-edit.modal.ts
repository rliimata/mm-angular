import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { confirmAction } from '../../../core/confirm.util';
import { errorMessage } from '../../../core/error.util';
import { titleWithYear } from '../../../core/format.util';
import { LookupRow, OwnershipDraft, OwnershipFormatDraft, OwnershipMovieDraft } from '../../../core/models';
import { AuthService } from '../../../core/auth.service';
import { LookupService } from '../../../data/lookup.service';
import { MovieService } from '../../../data/movie.service';
import {
  mediaFormatLong,
  OwnershipService,
  releaseRegionLabel,
} from '../../../data/ownership.service';
import { getSupabase } from '../../../core/supabase.client';
import { MultiCheckSelectComponent } from '../../../shared/multi-check-select.component';
import { SearchSelectComponent } from '../../../shared/search-select.component';

export type OwnershipSeedMovie = {
  Id: number;
  Title: string;
  TitleLanguageId: number | null;
  Year: number | null;
  RatioId: number | null;
};

@Component({
  selector: 'app-ownership-edit',
  standalone: true,
  imports: [FormsModule, MultiCheckSelectComponent, SearchSelectComponent],
  templateUrl: './ownership-edit.modal.html',
  styleUrl: './ownership-edit.modal.scss',
})
export class OwnershipEditModal implements OnInit, OnDestroy {
  /** null = new ownership */
  @Input() ownershipId: number | null = null;
  /** Stable snapshot from parent — do not pass a freshly allocated object each CD. */
  @Input() seedMovie: OwnershipSeedMovie | null = null;

  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly changed = new EventEmitter<void>();

  readonly saving = signal(false);
  readonly message = signal<string | null>(null);
  readonly booting = signal(true);

  mediaFormats: LookupRow[] = [];
  mediaFormatLabelMap: Record<number, string> = {};
  ratios: LookupRow[] = [];
  releaseRegions: LookupRow[] = [];
  releaseConditions: LookupRow[] = [];
  releasePublishers: LookupRow[] = [];
  ownershipTypes: LookupRow[] = [];
  finnishSubtitleId: number | null = null;
  englishSubtitleId: number | null = null;
  draft: OwnershipDraft = {
    name: '',
    notes: '',
    releaseRegionId: null,
    releaseConditionId: 3,
    releasePublisherId: null,
    ownershipTypeId: null,
    movies: [],
  };

  movieSearchOpen = false;
  movieSearchQuery = '';
  movieSearchResults: OwnershipSeedMovie[] = [];
  private movieSearchTimer: ReturnType<typeof setTimeout> | null = null;

  catalogAddOpen = false;
  catalogAddKind: 'ReleaseRegion' | 'ReleasePublisher' | 'OwnershipType' | 'Ratio' | null = null;
  catalogAddValue = '';
  catalogAddError: string | null = null;
  catalogAddMovieIndex = 0;
  catalogAddFormatIndex = 0;

  readonly titleWithYear = titleWithYear;

  private destroyed = false;
  private loadToken = 0;

  constructor(
    private readonly auth: AuthService,
    private readonly ownershipApi: OwnershipService,
    private readonly lookups: LookupService,
    private readonly movies: MovieService
  ) {}

  ngOnInit(): void {
    void this.bootstrapAndLoad();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadToken++;
    this.closeNested();
  }

  private async bootstrapAndLoad(): Promise<void> {
    const token = ++this.loadToken;
    this.booting.set(true);
    this.message.set(null);
    try {
      const [formats, ratios, regions, conditions, publishers, types, subs] = await Promise.all([
        this.lookups.get('MediaFormat'),
        this.lookups.get('Ratio'),
        this.lookups.get('ReleaseRegion'),
        this.lookups.get('ReleaseCondition'),
        this.lookups.get('ReleasePublisher'),
        this.lookups.get('OwnershipType'),
        this.lookups.get('ReleaseSubtitle'),
      ]);
      if (token !== this.loadToken || this.destroyed) {
        return;
      }

      this.mediaFormats = formats.filter((f) => f.Id > 0);
      this.mediaFormatLabelMap = Object.fromEntries(
        this.mediaFormats.map((f) => [f.Id, mediaFormatLong(f.Id) || String(f.Value)])
      );
      this.ratios = ratios.filter((r) => r.Id !== 0);
      this.releaseRegions = regions.map((r) => ({ ...r, Value: releaseRegionLabel(r.Value) }));
      this.releaseConditions = conditions;
      this.releasePublishers = this.sortAlpha(publishers);
      this.ownershipTypes = this.sortAlpha(types);
      this.resolveSubtitleIds(subs);

      if (this.ownershipId) {
        const draft = await this.ownershipApi.getDraft(this.ownershipId);
        if (token !== this.loadToken || this.destroyed) {
          return;
        }
        if (!draft) {
          this.message.set('Omistusta ei löytynyt.');
          return;
        }
        this.draft = draft;
      } else {
        this.draft = this.emptyDraft(true);
      }
    } catch (e: unknown) {
      if (token === this.loadToken && !this.destroyed) {
        this.message.set(errorMessage(e));
      }
    } finally {
      if (token === this.loadToken && !this.destroyed) {
        this.booting.set(false);
      }
    }
  }

  private resolveSubtitleIds(rows: LookupRow[]): void {
    const match = (aliases: string[]) =>
      rows.find((r) => aliases.includes(String(r.Value).trim().toLowerCase()))?.Id ?? null;
    this.finnishSubtitleId = match(['finnish', 'suomi']);
    this.englishSubtitleId = match(['english', 'englanti']);
  }

  private emptyDraft(seedMovie: boolean): OwnershipDraft {
    const seed = this.seedMovie;
    const movies: OwnershipMovieDraft[] =
      seedMovie && seed
        ? [
            {
              movieId: seed.Id,
              title: seed.Title,
              titleLanguageId: seed.TitleLanguageId,
              year: seed.Year,
              ratioId: seed.RatioId != null && seed.RatioId > 0 ? seed.RatioId : null,
              formatIds: [],
              formats: [],
            },
          ]
        : [];
    const regions = this.releaseRegions ?? [];
    return {
      name: '',
      notes: '',
      releaseRegionId: regions[0]?.Id ?? null,
      releaseConditionId: 3,
      releasePublisherId: null,
      ownershipTypeId: null,
      movies,
    };
  }

  private emptyFormat(mediaFormatId: number): OwnershipFormatDraft {
    return {
      mediaFormatId,
      ratioId: null,
      anamorphic: false,
      subtitleIds: [],
    };
  }

  private sortAlpha(rows: LookupRow[]): LookupRow[] {
    return [...rows].sort((a, b) =>
      String(a.Value).localeCompare(String(b.Value), 'fi', { sensitivity: 'base' })
    );
  }

  formatLabel(formatId: number): string {
    return this.mediaFormatLabelMap[formatId] || mediaFormatLong(formatId) || String(formatId);
  }

  isOriginalRatio(movie: OwnershipMovieDraft, format: OwnershipFormatDraft): boolean {
    return (
      movie.ratioId != null &&
      movie.ratioId > 0 &&
      format.ratioId != null &&
      format.ratioId === movie.ratioId
    );
  }

  hasSubtitle(format: OwnershipFormatDraft, id: number | null): boolean {
    return id != null && format.subtitleIds.includes(id);
  }

  toggleSubtitle(format: OwnershipFormatDraft, id: number | null, on: boolean): void {
    if (id == null) {
      return;
    }
    const has = format.subtitleIds.includes(id);
    if (on && !has) {
      format.subtitleIds = [...format.subtitleIds, id];
    } else if (!on && has) {
      format.subtitleIds = format.subtitleIds.filter((x) => x !== id);
    }
  }

  onFormatsChange(movie: OwnershipMovieDraft, ids: number[]): void {
    const nextIds = [...ids];
    if (
      movie.formatIds.length === nextIds.length &&
      movie.formatIds.every((id, i) => id === nextIds[i])
    ) {
      return;
    }
    const keep = new Map(movie.formats.map((f) => [f.mediaFormatId, f]));
    movie.formatIds = nextIds;
    movie.formats = nextIds.map((id) => keep.get(id) ?? this.emptyFormat(id));
  }

  close(): void {
    this.closeNested();
    this.closed.emit();
  }

  private closeNested(): void {
    this.closeMovieSearch();
    this.closeCatalogAdd();
  }

  openMovieSearch(): void {
    this.movieSearchQuery = '';
    this.movieSearchResults = [];
    this.movieSearchOpen = true;
  }

  closeMovieSearch(): void {
    this.movieSearchOpen = false;
    this.movieSearchQuery = '';
    this.movieSearchResults = [];
    if (this.movieSearchTimer) {
      clearTimeout(this.movieSearchTimer);
      this.movieSearchTimer = null;
    }
  }

  onMovieSearchInput(): void {
    if (this.movieSearchTimer) {
      clearTimeout(this.movieSearchTimer);
    }
    this.movieSearchTimer = setTimeout(() => void this.searchMovies(), 250);
  }

  async searchMovies(): Promise<void> {
    const q = this.movieSearchQuery.trim();
    if (q.length < 2) {
      this.movieSearchResults = [];
      return;
    }
    const res = await this.movies.search({
      query: q,
      mode: 'text',
      page: 1,
      pageSize: 12,
    });
    if (this.destroyed) {
      return;
    }
    const existing = new Set(this.draft.movies.map((m) => m.movieId));
    const rows = res.rows.filter((m) => !existing.has(m.Id));
    const ids = rows.map((m) => m.Id);
    let ratioMap = new Map<number, number | null>();
    if (ids.length) {
      const { data } = await getSupabase().from('Movie').select('Id, RatioId').in('Id', ids);
      if (this.destroyed) {
        return;
      }
      ratioMap = new Map(
        ((data as { Id: number; RatioId: number | null }[]) ?? []).map((r) => [r.Id, r.RatioId])
      );
    }
    this.movieSearchResults = rows.map((m) => ({
      Id: m.Id,
      Title: m.Title,
      TitleLanguageId: m.TitleLanguageId,
      Year: m.Year,
      RatioId: ratioMap.get(m.Id) ?? null,
    }));
  }

  addMovieToDraft(m: OwnershipSeedMovie): void {
    if (this.draft.movies.some((x) => x.movieId === m.Id)) {
      return;
    }
    this.draft.movies.push({
      movieId: m.Id,
      title: m.Title,
      titleLanguageId: m.TitleLanguageId,
      year: m.Year ?? null,
      ratioId: m.RatioId != null && m.RatioId > 0 ? m.RatioId : null,
      formatIds: [],
      formats: [],
    });
    this.closeMovieSearch();
  }

  async removeMovieFromDraft(index: number): Promise<void> {
    if (!(await confirmAction('Poistetaanko elokuva tästä omistuksesta?'))) {
      return;
    }
    this.draft.movies.splice(index, 1);
  }

  openCatalogAdd(
    kind: 'ReleaseRegion' | 'ReleasePublisher' | 'OwnershipType' | 'Ratio',
    movieIndex = 0,
    formatIndex = 0
  ): void {
    this.catalogAddKind = kind;
    this.catalogAddMovieIndex = movieIndex;
    this.catalogAddFormatIndex = formatIndex;
    this.catalogAddValue = '';
    this.catalogAddError = null;
    this.catalogAddOpen = true;
  }

  closeCatalogAdd(): void {
    this.catalogAddOpen = false;
    this.catalogAddKind = null;
    this.catalogAddValue = '';
    this.catalogAddError = null;
  }

  catalogAddTitle(): string {
    switch (this.catalogAddKind) {
      case 'ReleaseRegion':
        return 'Uusi versio';
      case 'ReleasePublisher':
        return 'Uusi julkaisija';
      case 'OwnershipType':
        return 'Uusi omistuksen tyyppi';
      case 'Ratio':
        return 'Uusi kuvasuhde';
      default:
        return 'Uusi arvo';
    }
  }

  async saveCatalogAdd(): Promise<void> {
    const kind = this.catalogAddKind;
    const value = this.catalogAddValue.trim();
    if (!kind || !value) {
      this.catalogAddError = 'Arvo ei voi olla tyhjä.';
      return;
    }
    try {
      const id = await this.ownershipApi.addCatalogValue(kind, value);
      this.lookups.invalidate(kind);
      if (kind === 'ReleaseRegion') {
        this.releaseRegions = (await this.lookups.get('ReleaseRegion')).map((r) => ({
          ...r,
          Value: releaseRegionLabel(r.Value),
        }));
        this.draft.releaseRegionId = id;
      } else if (kind === 'ReleasePublisher') {
        this.releasePublishers = this.sortAlpha(await this.lookups.get('ReleasePublisher'));
        this.draft.releasePublisherId = id;
      } else if (kind === 'OwnershipType') {
        this.ownershipTypes = this.sortAlpha(await this.lookups.get('OwnershipType'));
        this.draft.ownershipTypeId = id;
      } else {
        this.ratios = (await this.lookups.get('Ratio')).filter((r) => r.Id !== 0);
        const format = this.draft.movies[this.catalogAddMovieIndex]?.formats[this.catalogAddFormatIndex];
        if (format) {
          format.ratioId = id;
        }
      }
      this.closeCatalogAdd();
    } catch (e: unknown) {
      this.catalogAddError = errorMessage(e);
    }
  }

  async save(): Promise<void> {
    const userId = this.auth.profile()?.Id;
    if (!userId) {
      return;
    }
    this.saving.set(true);
    this.message.set(null);
    try {
      await this.ownershipApi.save(userId, this.draft);
      this.changed.emit();
      this.close();
    } catch (e: unknown) {
      this.message.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
