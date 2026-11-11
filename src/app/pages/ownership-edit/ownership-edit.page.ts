import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { confirmAction } from '../../core/confirm.util';
import { DetailRefreshService } from '../../core/detail-refresh.service';
import { errorMessage } from '../../core/error.util';
import { decodeEntities, titleWithYear } from '../../core/format.util';
import {
  LookupRow,
  OWNERSHIP_CONTENT_BONUS,
  OWNERSHIP_CONTENT_FEATURE,
  OwnershipDraft,
  OwnershipFormatDraft,
  OwnershipMovieDraft,
} from '../../core/models';
import { AuthService } from '../../core/auth.service';
import { LookupService } from '../../data/lookup.service';
import { MovieService } from '../../data/movie.service';
import {
  compareOwnershipFormats,
  emptyOwnershipFormat,
  isCassette,
  isDigitalCopy,
  isDisc,
  isFixedOriginalRatioFormat,
  mediaFormatLong,
  needsMediaCondition,
  OwnershipService,
} from '../../data/ownership.service';
import { getSupabase } from '../../core/supabase.client';
import { isPhoneViewport } from '../../core/viewport.util';
import { SearchSelectComponent } from '../../shared/search-select.component';
import { SentenceCaseDirective } from '../../shared/sentence-case.directive';

export type OwnershipSeedMovie = {
  Id: number;
  Title: string;
  TitleLanguageId: number | null;
  Year: number | null;
  RatioId: number | null;
  VersionLabel?: string | null;
};

type CatalogKind =
  | 'ReleaseRegion'
  | 'ReleasePublisher'
  | 'OwnershipType'
  | 'MediaRatio'
  | 'MediaContent'
  | 'ReleaseCondition'
  | 'MediaCondition';

@Component({
  selector: 'app-ownership-edit-page',
  standalone: true,
  imports: [FormsModule, SearchSelectComponent, SentenceCaseDirective],
  templateUrl: './ownership-edit.page.html',
  styleUrl: './ownership-edit.page.scss',
})
export class OwnershipEditPage implements OnInit, OnDestroy {
  @ViewChild('catalogValueInput') private catalogValueInput?: ElementRef<HTMLInputElement>;
  @ViewChild('movieSearchInput') private movieSearchInput?: ElementRef<HTMLInputElement>;

  movieId = 0;
  ownershipId: number | null = null;

  readonly saving = signal(false);
  readonly message = signal<string | null>(null);
  readonly booting = signal(true);

  mediaFormats: LookupRow[] = [];
  mediaFormatLabelMap: Record<number, string> = {};
  mediaRatios: LookupRow[] = [];
  releaseRegions: LookupRow[] = [];
  releaseConditions: LookupRow[] = [];
  mediaConditions: LookupRow[] = [];
  releasePublishers: LookupRow[] = [];
  ownershipTypes: LookupRow[] = [];
  contentOptions: LookupRow[] = [];
  finnishSubtitleId: number | null = null;
  englishSubtitleId: number | null = null;
  finnishAudioId: number | null = null;
  selectedMovieIndex = 0;

  draft: OwnershipDraft = {
    name: '',
    notes: '',
    releaseRegionId: null,
    releaseConditionId: 3,
    releasePublisherId: null,
    ownershipTypeId: null,
    movies: [],
  };

  mediaMenuForMovieIndex: number | null = null;
  movieSearchOpen = false;
  movieSearchQuery = '';
  movieSearchResults: OwnershipSeedMovie[] = [];
  /** When set, the next added movie is offered as a version checkbox for this medium. */
  linkFormatTarget: { hostMovieId: number; formatKey: string } | null = null;
  /** Catalog alternate cuts offered as checkboxes per host movie. */
  readonly versionOptionsByMovieId = new Map<number, OwnershipSeedMovie[]>();
  /** MovieIds already fetched from MovieLink catalog (may be empty). */
  private readonly versionOptionsLoaded = new Set<number>();
  /** Bumps when catalog version options change so checkboxes re-render. */
  readonly versionOptionsTick = signal(0);
  /** Movies that exist only as another cut on a disc — no own card in the collection. */
  private readonly satelliteMovieIds = new Set<number>();
  private movieSearchTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly VERSION_RELATION_IDS = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  ];

  catalogModalOpen = false;
  catalogModalMode: 'add' | 'edit' = 'add';
  catalogKind: CatalogKind | null = null;
  catalogEditId: number | null = null;
  catalogValue = '';
  catalogError: string | null = null;
  catalogMovieIndex = 0;
  catalogFormatIndex = 0;

  readonly titleWithYear = titleWithYear;
  readonly isCassette = isCassette;
  readonly isDisc = isDisc;
  readonly isDigitalCopy = isDigitalCopy;
  readonly needsMediaCondition = needsMediaCondition;
  readonly isFixedOriginalRatioFormat = isFixedOriginalRatioFormat;
  readonly OWNERSHIP_CONTENT_FEATURE = OWNERSHIP_CONTENT_FEATURE;

  private destroyed = false;
  private loadToken = 0;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly auth: AuthService,
    private readonly ownershipApi: OwnershipService,
    private readonly lookups: LookupService,
    private readonly movies: MovieService,
    private readonly detailRefresh: DetailRefreshService
  ) {}

  ngOnInit(): void {
    void this.bootstrapFromRoute();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadToken++;
    this.closeNested();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.mediaMenuForMovieIndex = null;
  }

  private async bootstrapFromRoute(): Promise<void> {
    const movieParam = this.route.snapshot.paramMap.get('movieId');
    const ownershipParam = this.route.snapshot.paramMap.get('ownershipId');
    this.movieId = Number(movieParam);
    this.ownershipId =
      ownershipParam && ownershipParam !== 'new' ? Number(ownershipParam) : null;
    if (isPhoneViewport()) {
      if (this.movieId > 0) {
        void this.router.navigate(['/movie', this.movieId]);
      } else {
        void this.router.navigateByUrl('/');
      }
      return;
    }
    await this.bootstrapAndLoad();
  }

  private async bootstrapAndLoad(): Promise<void> {
    const token = ++this.loadToken;
    this.booting.set(true);
    this.message.set(null);
    this.versionOptionsByMovieId.clear();
    this.versionOptionsLoaded.clear();
    this.versionOptionsTick.set(0);
    try {
      const [
        formats,
        mediaRatios,
        mediaContents,
        regions,
        conditions,
        mediaConditions,
        publishers,
        types,
        subs,
        audios,
      ] = await Promise.all([
        this.lookups.get('MediaFormat'),
        this.lookups.get('MediaRatio'),
        this.lookups.get('MediaContent'),
        this.lookups.get('ReleaseRegion'),
        this.lookups.get('ReleaseCondition'),
        this.lookups.get('MediaCondition'),
        this.lookups.get('ReleasePublisher'),
        this.lookups.get('OwnershipType'),
        this.lookups.get('ReleaseSubtitle'),
        this.lookups.get('ReleaseAudio'),
      ]);
      if (token !== this.loadToken || this.destroyed) {
        return;
      }

      this.mediaFormats = formats.filter((f) => f.Id > 0);
      this.mediaFormatLabelMap = Object.fromEntries(
        this.mediaFormats.map((f) => [f.Id, mediaFormatLong(f.Id) || String(f.Value)])
      );
      this.mediaRatios = mediaRatios.filter((r) => r.Id !== 0);
      this.contentOptions =
        mediaContents.length > 0
          ? mediaContents
          : [
              { Id: OWNERSHIP_CONTENT_FEATURE, Value: 'Feature' },
              { Id: OWNERSHIP_CONTENT_BONUS, Value: 'Bonus Disc' },
            ];
      this.releaseRegions = this.sortAlpha(regions);
      this.releaseConditions = conditions;
      this.mediaConditions = mediaConditions;
      this.releasePublishers = this.sortAlpha(publishers);
      this.ownershipTypes = this.sortAlpha(types);
      this.resolveSubtitleIds(subs);
      await this.resolveAudioIds(audios);
      if (token !== this.loadToken || this.destroyed) {
        return;
      }

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
        this.normalizeFixedRatios();
        this.applyForcedOwnershipRules();
        this.sortAllFormats();
        this.sortDraftMovies();
        this.markSatellitesFromDraft();
      } else {
        this.draft = await this.emptyDraftWithSeed();
        this.applyForcedOwnershipRules();
        this.satelliteMovieIds.clear();
      }
      await Promise.all(
        this.draft.movies
          .filter((m) => this.isVisibleMovieBlock(m))
          .map((m) => this.loadVersionOptions(m.movieId))
      );
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

  private async emptyDraftWithSeed(): Promise<OwnershipDraft> {
    const seed = await this.loadSeedMovie(this.movieId);
    const movies: OwnershipMovieDraft[] = seed
      ? [
          {
            movieId: seed.Id,
            title: seed.Title,
            titleLanguageId: seed.TitleLanguageId,
            year: seed.Year,
            ratioId: seed.RatioId != null && seed.RatioId > 0 ? seed.RatioId : null,
            versionLabel: seed.VersionLabel ?? null,
            formats: [],
          },
        ]
      : [];
    const suomi = this.releaseRegions.find(
      (r) => String(r.Value).trim().toLowerCase() === 'suomi'
    );
    return {
      name: '',
      notes: '',
      releaseRegionId: suomi?.Id ?? this.releaseRegions[0]?.Id ?? null,
      releaseConditionId: 3,
      releasePublisherId: null,
      ownershipTypeId: null,
      movies,
    };
  }

  private async loadSeedMovie(id: number): Promise<OwnershipSeedMovie | null> {
    if (!id) {
      return null;
    }
    const { data, error } = await getSupabase()
      .from('Movie')
      .select('Id, Title, TitleLanguageId, Year, RatioId, VersionId')
      .eq('Id', id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    const row = data as {
      Id: number;
      Title: string;
      TitleLanguageId: number | null;
      Year: number | null;
      RatioId: number | null;
      VersionId: number | null;
    };
    let versionLabel: string | null = null;
    if (row.VersionId != null && row.VersionId > 0) {
      const { data: ver } = await getSupabase()
        .from('Version')
        .select('Value')
        .eq('Id', row.VersionId)
        .maybeSingle();
      const raw = ver ? decodeEntities(String((ver as { Value: string }).Value)) : '';
      versionLabel = raw && raw !== '-' ? raw : null;
    }
    return {
      Id: row.Id,
      Title: row.Title,
      TitleLanguageId: row.TitleLanguageId,
      Year: row.Year,
      RatioId: row.RatioId,
      VersionLabel: versionLabel,
    };
  }

  originalMediaRatioId(): number | null {
    const hit = this.mediaRatios.find(
      (r) => String(r.Value).trim().toLowerCase() === 'alkuperäinen'
    );
    return hit?.Id ?? null;
  }

  hasAnyMedia(): boolean {
    return this.draft.movies.some((m) => m.formats.length > 0);
  }

  canSave(): boolean {
    return !this.saving() && !this.booting() && this.hasAnyMedia();
  }

  movieTitleBase(m: {
    title?: string;
    Title?: string;
    titleLanguageId?: number | null;
    TitleLanguageId?: number | null;
    year?: number | null;
    Year?: number | null;
  }): string {
    return titleWithYear(
      m.title ?? m.Title,
      m.titleLanguageId ?? m.TitleLanguageId ?? null,
      m.year ?? m.Year ?? null
    );
  }

  movieVersionLabel(m: { versionLabel?: string | null; VersionLabel?: string | null }): string {
    const version = decodeEntities((m.versionLabel ?? m.VersionLabel)?.trim() ?? '');
    return !version || version === '-' ? '' : version;
  }

  /** Plain title for page heading (version included, no -versio suffix). */
  movieDisplayTitle(m: {
    title?: string;
    Title?: string;
    titleLanguageId?: number | null;
    TitleLanguageId?: number | null;
    year?: number | null;
    Year?: number | null;
    versionLabel?: string | null;
    VersionLabel?: string | null;
  }): string {
    const base = this.movieTitleBase(m);
    const version = this.movieVersionLabel(m);
    if (!version) {
      return base;
    }
    return base ? `${base} – ${version}` : version;
  }

  private applyFixedRatio(format: OwnershipFormatDraft): void {
    if (!isFixedOriginalRatioFormat(format.mediaFormatId)) {
      return;
    }
    const id = this.originalMediaRatioId();
    if (id != null) {
      format.ratioId = id;
    }
  }

  private normalizeFixedRatios(): void {
    for (const m of this.draft.movies) {
      for (const f of m.formats) {
        this.applyFixedRatio(f);
      }
    }
  }

  private resolveSubtitleIds(rows: LookupRow[]): void {
    const match = (aliases: string[]) =>
      rows.find((r) => aliases.includes(String(r.Value).trim().toLowerCase()))?.Id ?? null;
    this.finnishSubtitleId = match(['finnish', 'suomi']);
    this.englishSubtitleId = match(['english', 'englanti']);
  }

  private async resolveAudioIds(rows: LookupRow[]): Promise<void> {
    const match = (list: LookupRow[], aliases: string[]) =>
      list.find((r) => aliases.includes(String(r.Value).trim().toLowerCase()))?.Id ?? null;
    this.finnishAudioId = match(rows, ['finnish', 'suomi']);
    if (this.finnishAudioId == null) {
      this.finnishAudioId = await this.ownershipApi.addCatalogValue('ReleaseAudio', 'Suomi');
      this.lookups.invalidate('ReleaseAudio');
    }
  }

  private focusCatalogValueInput(): void {
    setTimeout(() => this.catalogValueInput?.nativeElement.focus(), 0);
  }

  sortDraftMovies(): void {
    const ctx = this.movieId;
    this.draft.movies.sort((a, b) => {
      if (a.movieId === ctx && b.movieId !== ctx) {
        return -1;
      }
      if (b.movieId === ctx && a.movieId !== ctx) {
        return 1;
      }
      const va = a.versionLabel ? 1 : 0;
      const vb = b.versionLabel ? 1 : 0;
      if (va !== vb) {
        return va - vb;
      }
      return this.movieTitleBase(a).localeCompare(this.movieTitleBase(b), 'fi', {
        sensitivity: 'base',
      });
    });
  }

  private sortAlpha(rows: LookupRow[]): LookupRow[] {
    return [...rows].sort((a, b) =>
      String(a.Value).localeCompare(String(b.Value), 'fi', { sensitivity: 'base' })
    );
  }

  pageTitle(): string {
    return this.ownershipId ? 'Muokkaa omistusta' : 'Lisää omistus';
  }

  sortMovieFormats(movie: OwnershipMovieDraft): void {
    movie.formats.sort(compareOwnershipFormats);
  }

  sortAllFormats(): void {
    for (const m of this.draft.movies) {
      this.sortMovieFormats(m);
    }
  }

  onContentTypeChange(movie: OwnershipMovieDraft): void {
    this.sortMovieFormats(movie);
  }

  formatLabel(formatId: number): string {
    return this.mediaFormatLabelMap[formatId] || mediaFormatLong(formatId) || String(formatId);
  }

  discColor(formatId: number): string {
    const map: Record<number, string> = {
      1: '#1e5a9e',
      2: '#c4a035',
      3: '#6b4c9a',
      4: '#888',
      6: '#2d6a4f',
      7: '#0d7377',
      11: '#1f4b7a',
      12: '#555',
    };
    return map[formatId] ?? '#444';
  }

  hasSubtitle(format: OwnershipFormatDraft, id: number | null): boolean {
    return id != null && format.subtitleIds.includes(id);
  }

  isCaseConditionNew(): boolean {
    const id = this.draft.releaseConditionId;
    if (id == null) {
      return false;
    }
    const row = this.releaseConditions.find((r) => r.Id === id);
    return String(row?.Value ?? '')
      .trim()
      .toLowerCase() === 'uusi';
  }

  uusiMediaConditionId(): number | null {
    return (
      this.mediaConditions.find((r) => String(r.Value).trim().toLowerCase() === 'uusi')?.Id ?? null
    );
  }

  regionImpliesFinnishSubs(): boolean {
    const id = this.draft.releaseRegionId;
    if (id == null) {
      return false;
    }
    const raw = String(this.releaseRegions.find((r) => r.Id === id)?.Value ?? '')
      .trim()
      .toLowerCase();
    return raw === 'suomi' || raw === 'nordic' || raw === 'pohjoismaat';
  }

  onReleaseConditionChange(): void {
    this.applyForcedMediaConditions();
  }

  onReleaseRegionChange(): void {
    this.applyForcedFinnishSubtitles();
  }

  private applyForcedOwnershipRules(): void {
    this.applyForcedMediaConditions();
    this.applyForcedFinnishSubtitles();
  }

  private applyForcedMediaConditions(): void {
    if (!this.isCaseConditionNew()) {
      return;
    }
    const id = this.uusiMediaConditionId();
    if (id == null) {
      return;
    }
    for (const m of this.draft.movies) {
      for (const f of m.formats) {
        if (needsMediaCondition(f)) {
          f.mediaConditionId = id;
        }
      }
    }
  }

  onDigitalHasDiscChange(format: OwnershipFormatDraft, hasDisc: boolean): void {
    format.digitalHasDisc = hasDisc;
    if (!hasDisc) {
      format.mediaConditionId = null;
      return;
    }
    if (this.isCaseConditionNew()) {
      format.mediaConditionId = this.uusiMediaConditionId();
    }
  }

  private applyForcedFinnishSubtitles(): void {
    if (!this.regionImpliesFinnishSubs() || this.finnishSubtitleId == null) {
      return;
    }
    const id = this.finnishSubtitleId;
    for (const m of this.draft.movies) {
      for (const f of m.formats) {
        if (!f.subtitleIds.includes(id)) {
          f.subtitleIds = [...f.subtitleIds, id];
        }
      }
    }
  }

  toggleSubtitle(format: OwnershipFormatDraft, id: number | null, on: boolean): void {
    if (id == null) {
      return;
    }
    if (id === this.finnishSubtitleId && this.regionImpliesFinnishSubs()) {
      return;
    }
    const has = format.subtitleIds.includes(id);
    if (on && !has) {
      format.subtitleIds = [...format.subtitleIds, id];
    } else if (!on && has) {
      format.subtitleIds = format.subtitleIds.filter((x) => x !== id);
    }
  }

  hasAudio(format: OwnershipFormatDraft, id: number | null): boolean {
    return id != null && (format.audioIds ?? []).includes(id);
  }

  async onFinnishAudioChange(format: OwnershipFormatDraft, on: boolean): Promise<void> {
    if (this.finnishAudioId == null) {
      await this.resolveAudioIds(await this.lookups.get('ReleaseAudio'));
    }
    const id = this.finnishAudioId;
    if (id == null) {
      return;
    }
    if (!format.audioIds) {
      format.audioIds = [];
    }
    const has = format.audioIds.includes(id);
    if (on && !has) {
      format.audioIds = [...format.audioIds, id];
    } else if (!on && has) {
      format.audioIds = format.audioIds.filter((x) => x !== id);
    }
  }

  selectMovieForMedia(index: number): void {
    this.selectedMovieIndex = index;
  }

  toggleMediaMenu(event: MouseEvent, movieIndex: number): void {
    event.stopPropagation();
    this.selectedMovieIndex = movieIndex;
    this.mediaMenuForMovieIndex =
      this.mediaMenuForMovieIndex === movieIndex ? null : movieIndex;
  }

  addMediaFormat(movie: OwnershipMovieDraft | undefined, formatId: number, event?: MouseEvent): void {
    event?.stopPropagation();
    this.mediaMenuForMovieIndex = null;
    if (!movie) {
      return;
    }
    const format = emptyOwnershipFormat(formatId, {
      ratioId: isFixedOriginalRatioFormat(formatId) ? this.originalMediaRatioId() : null,
    });
    movie.formats.push(format);
    this.applyForcedOwnershipRules();
    this.sortMovieFormats(movie);
    void this.loadVersionOptions(movie.movieId);
  }

  duplicateMediaBlock(movie: OwnershipMovieDraft, format: OwnershipFormatDraft): void {
    const next = emptyOwnershipFormat(format.mediaFormatId, {
      ratioId: isFixedOriginalRatioFormat(format.mediaFormatId)
        ? this.originalMediaRatioId()
        : null,
    });
    movie.formats.push(next);
    this.applyForcedOwnershipRules();
    this.sortMovieFormats(movie);
  }

  async removeMediaBlock(movie: OwnershipMovieDraft, index: number): Promise<void> {
    if (!(await confirmAction('Poistetaanko tämä media?'))) {
      return;
    }
    movie.formats.splice(index, 1);
  }

  cancel(): void {
    void this.router.navigate(['/movie', this.movieId]);
  }

  closeNested(): void {
    this.closeMovieSearch();
    this.closeCatalogModal();
    this.mediaMenuForMovieIndex = null;
  }

  openMovieSearch(): void {
    this.linkFormatTarget = null;
    this.movieSearchQuery = '';
    this.movieSearchResults = [];
    this.movieSearchOpen = true;
    setTimeout(() => this.movieSearchInput?.nativeElement.focus(), 0);
  }

  openVersionSearchForFormat(host: OwnershipMovieDraft, format: OwnershipFormatDraft): void {
    this.linkFormatTarget = { hostMovieId: host.movieId, formatKey: format.key };
    this.movieSearchQuery = '';
    this.movieSearchResults = [];
    this.movieSearchOpen = true;
    setTimeout(() => this.movieSearchInput?.nativeElement.focus(), 0);
  }

  closeMovieSearch(): void {
    this.movieSearchOpen = false;
    this.movieSearchQuery = '';
    this.movieSearchResults = [];
    this.linkFormatTarget = null;
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
      pageSize: 40,
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
      VersionLabel: m.VersionLabel ?? null,
    }));
  }

  addMovieToDraft(m: OwnershipSeedMovie): void {
    const linkTarget = this.linkFormatTarget;
    const seed: OwnershipSeedMovie = {
      ...m,
      VersionLabel: m.VersionLabel ? decodeEntities(m.VersionLabel) : m.VersionLabel,
    };
    const existing = this.draft.movies.find((x) => x.movieId === seed.Id);
    if (!existing) {
      const row: OwnershipMovieDraft = {
        movieId: seed.Id,
        title: seed.Title,
        titleLanguageId: seed.TitleLanguageId,
        year: seed.Year ?? null,
        ratioId: seed.RatioId != null && seed.RatioId > 0 ? seed.RatioId : null,
        versionLabel: seed.VersionLabel ?? null,
        formats: [],
      };
      if (linkTarget) {
        // Extra title on this disc: checkbox only (cut or different film).
        this.draft.movies.push(row);
        this.satelliteMovieIds.add(seed.Id);
        this.addVersionOption(linkTarget.hostMovieId, seed);
      } else {
        // Separate title with its own media card(s).
        this.satelliteMovieIds.delete(seed.Id);
        this.draft.movies.unshift(row);
        this.selectedMovieIndex = 0;
      }
    } else if (linkTarget) {
      this.satelliteMovieIds.add(seed.Id);
      this.addVersionOption(linkTarget.hostMovieId, seed);
    } else {
      this.satelliteMovieIds.delete(seed.Id);
    }

    if (linkTarget) {
      const host = this.draft.movies.find((x) => x.movieId === linkTarget.hostMovieId);
      const format = host?.formats.find((f) => f.key === linkTarget.formatKey);
      if (host && format) {
        this.toggleFormatLinkedMovie(host, format, seed, true);
      }
      this.selectedMovieIndex = Math.max(
        0,
        this.draft.movies.findIndex((x) => x.movieId === linkTarget.hostMovieId)
      );
      this.linkFormatTarget = null;
      this.closeMovieSearch();
      return;
    }

    if (existing) {
      this.closeMovieSearch();
      return;
    }

    this.closeMovieSearch();
    setTimeout(() => {
      document.querySelector('.movie-block')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }

  /** Collection members show a card; same-disc cuts (satellites) do not. */
  isVisibleMovieBlock(m: OwnershipMovieDraft): boolean {
    return m.formats.length > 0 || !this.satelliteMovieIds.has(m.movieId);
  }

  visibleMovieCount(): number {
    return this.draft.movies.filter((m) => this.isVisibleMovieBlock(m)).length;
  }

  isFormatLinkedToMovie(format: OwnershipFormatDraft, movieId: number): boolean {
    return (format.linkedMovieIds ?? []).includes(movieId);
  }

  /**
   * Ready checkboxes for this host only: MovieLink catalog cuts + titles added via +.
   * Do NOT list every other collection movie — that flooded each card.
   */
  versionChoicesFor(host: OwnershipMovieDraft): OwnershipSeedMovie[] {
    void this.versionOptionsTick();
    return (this.versionOptionsByMovieId.get(host.movieId) ?? [])
      .filter((o) => o.Id !== host.movieId)
      .map((o) => ({
        ...o,
        VersionLabel: o.VersionLabel ? decodeEntities(o.VersionLabel) : o.VersionLabel,
      }))
      .sort((a, b) =>
        this.movieTitleBase(a).localeCompare(this.movieTitleBase(b), 'fi', { sensitivity: 'base' })
      );
  }

  toggleFormatLinkedMovie(
    host: OwnershipMovieDraft,
    format: OwnershipFormatDraft,
    movie: OwnershipSeedMovie,
    checked: boolean
  ): void {
    if (movie.Id === host.movieId) {
      return;
    }
    // Resolve from draft by key so we mutate the live format row.
    const liveHost = this.draft.movies.find((m) => m.movieId === host.movieId) ?? host;
    const liveFormat =
      liveHost.formats.find((f) => f.key === format.key) ?? format;
    const set = new Set(liveFormat.linkedMovieIds ?? []);
    if (checked) {
      set.add(movie.Id);
      this.ensureSatelliteMovie(movie);
    } else {
      set.delete(movie.Id);
      this.pruneUnusedSatellite(movie.Id);
    }
    liveFormat.linkedMovieIds = [...set];
  }

  private ensureSatelliteMovie(m: OwnershipSeedMovie): void {
    this.satelliteMovieIds.add(m.Id);
    if (this.draft.movies.some((x) => x.movieId === m.Id)) {
      return;
    }
    this.draft.movies.push({
      movieId: m.Id,
      title: m.Title,
      titleLanguageId: m.TitleLanguageId,
      year: m.Year ?? null,
      ratioId: m.RatioId != null && m.RatioId > 0 ? m.RatioId : null,
      versionLabel: m.VersionLabel ?? null,
      formats: [],
    });
  }

  private pruneUnusedSatellite(movieId: number): void {
    if (!this.satelliteMovieIds.has(movieId)) {
      return;
    }
    const row = this.draft.movies.find((m) => m.movieId === movieId);
    if (!row || row.formats.length > 0) {
      return;
    }
    const stillLinked = this.draft.movies.some((m) =>
      m.formats.some((f) => (f.linkedMovieIds ?? []).includes(movieId))
    );
    if (!stillLinked) {
      this.draft.movies = this.draft.movies.filter((m) => m.movieId !== movieId);
      this.satelliteMovieIds.delete(movieId);
    }
  }

  private markSatellitesFromDraft(): void {
    this.satelliteMovieIds.clear();
    const linked = new Set<number>();
    for (const m of this.draft.movies) {
      for (const f of m.formats) {
        for (const id of f.linkedMovieIds ?? []) {
          linked.add(id);
        }
      }
    }
    for (const m of this.draft.movies) {
      if (m.formats.length === 0 && linked.has(m.movieId)) {
        this.satelliteMovieIds.add(m.movieId);
        for (const host of this.draft.movies) {
          if (host.formats.some((f) => (f.linkedMovieIds ?? []).includes(m.movieId))) {
            this.addVersionOption(host.movieId, {
              Id: m.movieId,
              Title: m.title,
              TitleLanguageId: m.titleLanguageId,
              Year: m.year,
              RatioId: m.ratioId,
              VersionLabel: m.versionLabel ?? null,
            });
          }
        }
      }
    }
  }

  private addVersionOption(hostMovieId: number, m: OwnershipSeedMovie): void {
    const list = this.versionOptionsByMovieId.get(hostMovieId) ?? [];
    if (!list.some((x) => x.Id === m.Id)) {
      list.push(m);
      this.versionOptionsByMovieId.set(hostMovieId, list);
      this.versionOptionsTick.update((n) => n + 1);
    }
  }

  async loadVersionOptions(movieId: number): Promise<void> {
    // Always fetch catalog cuts once; do not skip just because + / satellites pre-seeded the map.
    if (this.versionOptionsLoaded.has(movieId)) {
      return;
    }
    this.versionOptionsLoaded.add(movieId);
    const rels = OwnershipEditPage.VERSION_RELATION_IDS;
    const [{ data: out }, { data: inn }] = await Promise.all([
      getSupabase()
        .from('MovieLink')
        .select('DestinationId')
        .eq('SourceId', movieId)
        .in('RelationId', rels),
      getSupabase()
        .from('MovieLink')
        .select('SourceId')
        .eq('DestinationId', movieId)
        .in('RelationId', rels),
    ]);
    if (this.destroyed) {
      return;
    }
    const ids = [
      ...new Set([
        ...(((out as { DestinationId: number }[]) ?? []).map((r) => r.DestinationId)),
        ...(((inn as { SourceId: number }[]) ?? []).map((r) => r.SourceId)),
      ]),
    ].filter((id) => id !== movieId);
    const existing = this.versionOptionsByMovieId.get(movieId) ?? [];
    if (!ids.length) {
      this.versionOptionsByMovieId.set(movieId, existing);
      this.versionOptionsTick.update((n) => n + 1);
      return;
    }
    const { data } = await getSupabase()
      .from('Movie')
      .select('Id, Title, TitleLanguageId, Year, RatioId, VersionId')
      .in('Id', ids);
    if (this.destroyed) {
      return;
    }
    const rows =
      (data as {
        Id: number;
        Title: string;
        TitleLanguageId: number | null;
        Year: number | null;
        RatioId: number | null;
        VersionId: number | null;
      }[]) ?? [];
    const versionIds = [
      ...new Set(rows.map((r) => r.VersionId).filter((id): id is number => id != null && id > 0)),
    ];
    let versionMap = new Map<number, string>();
    if (versionIds.length) {
      const { data: versions } = await getSupabase()
        .from('Version')
        .select('Id, Value')
        .in('Id', versionIds);
      versionMap = new Map(
        ((versions as { Id: number; Value: string }[]) ?? []).map((v) => [
          v.Id,
          decodeEntities(String(v.Value)),
        ])
      );
    }
    const catalog: OwnershipSeedMovie[] = rows.map((r) => {
      const raw =
        r.VersionId != null && r.VersionId > 0 ? versionMap.get(r.VersionId) ?? null : null;
      return {
        Id: r.Id,
        Title: r.Title,
        TitleLanguageId: r.TitleLanguageId,
        Year: r.Year,
        RatioId: r.RatioId,
        VersionLabel: raw && raw !== '-' ? raw : null,
      };
    });
    const byId = new Map<number, OwnershipSeedMovie>();
    for (const o of catalog) {
      byId.set(o.Id, o);
    }
    for (const o of existing) {
      if (!byId.has(o.Id)) {
        byId.set(o.Id, o);
      }
    }
    this.versionOptionsByMovieId.set(movieId, [...byId.values()]);
    this.versionOptionsTick.update((n) => n + 1);
  }

  async removeMovieFromDraft(index: number): Promise<void> {
    if (!(await confirmAction('Poistetaanko elokuva tästä omistuksesta?'))) {
      return;
    }
    const removed = this.draft.movies[index];
    this.draft.movies.splice(index, 1);
    if (removed) {
      this.satelliteMovieIds.delete(removed.movieId);
      for (const m of this.draft.movies) {
        for (const f of m.formats) {
          f.linkedMovieIds = (f.linkedMovieIds ?? []).filter((id) => id !== removed.movieId);
        }
      }
    }
    if (this.selectedMovieIndex >= this.draft.movies.length) {
      this.selectedMovieIndex = Math.max(0, this.draft.movies.length - 1);
    }
  }

  catalogRows(kind: CatalogKind): LookupRow[] {
    switch (kind) {
      case 'ReleaseRegion':
        return this.releaseRegions;
      case 'ReleasePublisher':
        return this.releasePublishers;
      case 'OwnershipType':
        return this.ownershipTypes;
      case 'MediaRatio':
        return this.mediaRatios;
      case 'MediaContent':
        return this.contentOptions;
      case 'ReleaseCondition':
        return this.releaseConditions;
      case 'MediaCondition':
        return this.mediaConditions;
    }
  }

  openCatalogAdd(kind: CatalogKind, movieIndex = 0, formatIndex = 0): void {
    this.catalogModalMode = 'add';
    this.catalogKind = kind;
    this.catalogEditId = null;
    this.catalogMovieIndex = movieIndex;
    this.catalogFormatIndex = formatIndex;
    this.catalogValue = '';
    this.catalogError = null;
    this.catalogModalOpen = true;
    this.focusCatalogValueInput();
  }

  openCatalogEdit(
    kind: CatalogKind,
    selectedId: number | null,
    movieIndex = 0,
    formatIndex = 0
  ): void {
    if (selectedId == null) {
      return;
    }
    const row = this.catalogRows(kind).find((r) => r.Id === selectedId);
    if (!row) {
      return;
    }
    this.catalogModalMode = 'edit';
    this.catalogKind = kind;
    this.catalogEditId = selectedId;
    this.catalogMovieIndex = movieIndex;
    this.catalogFormatIndex = formatIndex;
    this.catalogValue = String(row.Value);
    this.catalogError = null;
    this.catalogModalOpen = true;
    this.focusCatalogValueInput();
  }

  closeCatalogModal(): void {
    this.catalogModalOpen = false;
    this.catalogKind = null;
    this.catalogEditId = null;
    this.catalogValue = '';
    this.catalogError = null;
  }

  catalogModalTitle(): string {
    const edit = this.catalogModalMode === 'edit';
    switch (this.catalogKind) {
      case 'ReleaseRegion':
        return edit ? 'Muokkaa versiota' : 'Uusi versio';
      case 'ReleasePublisher':
        return edit ? 'Muokkaa julkaisijaa' : 'Uusi julkaisija';
      case 'OwnershipType':
        return edit ? 'Muokkaa omistuksen tyyppiä' : 'Uusi omistuksen tyyppi';
      case 'MediaRatio':
        return edit ? 'Muokkaa median kuvasuhdetta' : 'Uusi median kuvasuhde';
      case 'MediaContent':
        return edit ? 'Muokkaa sisältöä' : 'Uusi sisältö';
      case 'ReleaseCondition':
        return edit ? 'Muokkaa kotelon kuntoa' : 'Uusi kotelon kunto';
      case 'MediaCondition':
        return edit ? 'Muokkaa median kuntoa' : 'Uusi median kunto';
      default:
        return edit ? 'Muokkaa arvoa' : 'Uusi arvo';
    }
  }

  async saveCatalogModal(): Promise<void> {
    const kind = this.catalogKind;
    const value = this.catalogValue.trim();
    if (!kind || !value) {
      this.catalogError = 'Arvo ei voi olla tyhjä.';
      return;
    }
    try {
      if (this.catalogModalMode === 'edit' && this.catalogEditId != null) {
        await this.ownershipApi.updateCatalogValue(kind, this.catalogEditId, value);
        this.lookups.invalidate(kind);
        await this.reloadCatalogKind(kind);
      } else {
        const id = await this.ownershipApi.addCatalogValue(kind, value);
        this.lookups.invalidate(kind);
        await this.reloadCatalogKind(kind);
        this.applyCatalogSelection(kind, id);
      }
      this.closeCatalogModal();
    } catch (e: unknown) {
      this.catalogError = errorMessage(e);
    }
  }

  private async reloadCatalogKind(kind: CatalogKind): Promise<void> {
    if (kind === 'ReleaseRegion') {
      this.releaseRegions = this.sortAlpha(await this.lookups.get('ReleaseRegion'));
    } else if (kind === 'ReleasePublisher') {
      this.releasePublishers = this.sortAlpha(await this.lookups.get('ReleasePublisher'));
    } else if (kind === 'OwnershipType') {
      this.ownershipTypes = this.sortAlpha(await this.lookups.get('OwnershipType'));
    } else if (kind === 'MediaRatio') {
      this.mediaRatios = (await this.lookups.get('MediaRatio')).filter((r) => r.Id !== 0);
    } else if (kind === 'MediaContent') {
      this.contentOptions = await this.lookups.get('MediaContent');
    } else if (kind === 'ReleaseCondition') {
      this.releaseConditions = await this.lookups.get('ReleaseCondition');
    } else if (kind === 'MediaCondition') {
      this.mediaConditions = await this.lookups.get('MediaCondition');
    }
  }

  private applyCatalogSelection(kind: CatalogKind, id: number): void {
    if (kind === 'ReleaseRegion') {
      this.draft.releaseRegionId = id;
    } else if (kind === 'ReleasePublisher') {
      this.draft.releasePublisherId = id;
    } else if (kind === 'OwnershipType') {
      this.draft.ownershipTypeId = id;
    } else if (kind === 'MediaRatio') {
      const format = this.draft.movies[this.catalogMovieIndex]?.formats[this.catalogFormatIndex];
      if (format) {
        format.ratioId = id;
      }
    } else if (kind === 'MediaContent') {
      const format = this.draft.movies[this.catalogMovieIndex]?.formats[this.catalogFormatIndex];
      if (format) {
        format.contentType = id;
        const movie = this.draft.movies[this.catalogMovieIndex];
        if (movie) {
          this.onContentTypeChange(movie);
        }
      }
    } else if (kind === 'ReleaseCondition') {
      this.draft.releaseConditionId = id;
    } else if (kind === 'MediaCondition') {
      const format = this.draft.movies[this.catalogMovieIndex]?.formats[this.catalogFormatIndex];
      if (format) {
        format.mediaConditionId = id;
      }
    }
  }

  async deleteCatalogOption(kind: CatalogKind, id: number | null): Promise<void> {
    if (id == null) {
      return;
    }
    const row = this.catalogRows(kind).find((r) => r.Id === id);
    if (!row) {
      return;
    }
    if (!(await confirmAction(`Poistetaanko arvo "${row.Value}"?`))) {
      return;
    }
    try {
      await this.ownershipApi.deleteCatalogValue(kind, id);
      this.lookups.invalidate(kind);
      await this.reloadCatalogKind(kind);
      if (kind === 'ReleaseRegion' && this.draft.releaseRegionId === id) {
        this.draft.releaseRegionId = null;
      } else if (kind === 'ReleasePublisher' && this.draft.releasePublisherId === id) {
        this.draft.releasePublisherId = null;
      } else if (kind === 'OwnershipType' && this.draft.ownershipTypeId === id) {
        this.draft.ownershipTypeId = null;
      } else if (kind === 'ReleaseCondition' && this.draft.releaseConditionId === id) {
        this.draft.releaseConditionId = null;
      } else if (kind === 'MediaCondition') {
        for (const m of this.draft.movies) {
          for (const f of m.formats) {
            if (f.mediaConditionId === id) {
              f.mediaConditionId = null;
            }
          }
        }
      } else if (kind === 'MediaRatio') {
        for (const m of this.draft.movies) {
          for (const f of m.formats) {
            if (f.ratioId === id) {
              f.ratioId = null;
            }
          }
        }
      }
    } catch (e: unknown) {
      this.message.set(errorMessage(e));
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
      if (this.ownershipId) {
        this.draft.id = this.ownershipId;
      }
      const movieIds = [
        ...new Set([
          this.movieId,
          ...this.draft.movies.map((m) => m.movieId),
          ...this.draft.movies.flatMap((m) =>
            m.formats.flatMap((f) => f.linkedMovieIds ?? [])
          ),
        ]),
      ].filter((id) => id > 0);
      await this.ownershipApi.save(userId, this.draft);
      for (const id of movieIds) {
        this.detailRefresh.movieSaved(id);
      }
      await this.router.navigate(['/movie', this.movieId]);
    } catch (e: unknown) {
      this.message.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
