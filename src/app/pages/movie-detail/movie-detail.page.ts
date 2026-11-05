import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { confirmAction, showError } from '../../core/confirm.util';
import { DetailRefreshService } from '../../core/detail-refresh.service';
import { errorMessage } from '../../core/error.util';
import {
  ageRatingLabel,
  formatRuntimeMinutes,
  palMinutesFromNtsc,
  resolveNtscMinutes,
  swapNames,
  swapTitle,
  titleWithYear,
} from '../../core/format.util';
import { LookupRow, OwnershipDraft, OwnershipFormatDraft, OwnershipMovieDraft } from '../../core/models';
import { LookupService } from '../../data/lookup.service';
import { MovieDetails, MovieService } from '../../data/movie.service';
import {
  mediaFormatLong,
  mediaFormatShort,
  OwnershipService,
  OwnershipSummary,
  releaseRegionLabel,
} from '../../data/ownership.service';
import { UserLinkService } from '../../data/user-link.service';
import { WatchlistService } from '../../data/watchlist.service';
import { MultiCheckSelectComponent } from '../../shared/multi-check-select.component';

@Component({
  selector: 'app-movie-detail',
  standalone: true,
  imports: [RouterLink, RouterOutlet, FormsModule, MultiCheckSelectComponent],
  templateUrl: './movie-detail.page.html',
  styleUrl: './movie-detail.page.scss',
})
export class MovieDetailPage implements OnInit, OnDestroy {
  readonly details = signal<MovieDetails | null>(null);
  readonly reviews = signal<{ UserId: number; ScoreId: number | null; Text: string | null; Name: string }[]>(
    []
  );
  readonly ownerships = signal<OwnershipSummary[]>([]);
  readonly onWatchlist = signal(false);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly message = signal<string | null>(null);
  readonly ownershipMessage = signal<string | null>(null);
  readonly ratingOpen = signal(false);
  readonly ownershipOpen = signal(false);
  readonly mergeOpen = signal(false);
  mergeKeepId: number | null = null;
  mergeAbsorbId: number | null = null;
  mergeError: string | null = null;

  scoreId: number | null = null;
  hoverScoreId: number | null = null;
  reviewText = '';
  scores: LookupRow[] = [];
  mediaFormats: LookupRow[] = [];
  releaseAudios: LookupRow[] = [];
  releaseSubtitles: LookupRow[] = [];
  releaseRegions: LookupRow[] = [];
  releasePictures: LookupRow[] = [];
  releaseConditions: LookupRow[] = [];
  releasePublishers: LookupRow[] = [];
  ownershipTypes: LookupRow[] = [];

  ownershipDraft: OwnershipDraft = this.emptyOwnershipDraft();
  movieSearchQuery = '';
  movieSearchResults: { Id: number; Title: string; TitleLanguageId: number | null; Year: number | null }[] =
    [];
  mediaFormatLabelMap: Record<number, string> = {};
  catalogAddOpen = false;
  catalogAddKind:
    | 'ReleaseAudio'
    | 'ReleaseSubtitle'
    | 'ReleasePicture'
    | 'ReleaseRegion'
    | 'ReleasePublisher'
    | 'OwnershipType'
    | null = null;
  catalogAddValue = '';
  catalogAddMovieIndex = 0;
  catalogAddFormatIndex = 0;
  catalogAddError: string | null = null;
  movieSearchOpen = false;
  private movieSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly swapNames = swapNames;
  readonly swapTitle = swapTitle;
  readonly titleWithYear = titleWithYear;
  readonly mediaFormatShort = mediaFormatShort;
  readonly ageLabel = ageRatingLabel;

  private movieId = 0;
  private routeSub: Subscription | null = null;
  private refreshSub: Subscription | null = null;
  private bootstrapped = false;

  constructor(
    readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly movies: MovieService,
    private readonly userLinks: UserLinkService,
    private readonly watchlist: WatchlistService,
    private readonly ownershipApi: OwnershipService,
    private readonly lookups: LookupService,
    private readonly detailRefresh: DetailRefreshService
  ) {}

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const nextId = Number(params.get('id'));
      if (!nextId) {
        return;
      }
      const changed = nextId !== this.movieId;
      this.movieId = nextId;
      this.refreshSub?.unsubscribe();
      this.refreshSub = this.detailRefresh.onMovie(nextId).subscribe(() => {
        void this.load();
      });
      if (!this.bootstrapped) {
        this.bootstrapped = true;
        void this.bootstrap();
        return;
      }
      if (changed) {
        void this.load();
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
  }

  private async bootstrap(): Promise<void> {
    this.lookups.invalidate('ReleaseAudio');
    this.lookups.invalidate('ReleaseSubtitle');
    this.lookups.invalidate('ReleaseRegion');
    const [scores, formats, audios, subs, regions, pictures, conditions, publishers, types] =
      await Promise.all([
        this.lookups.get('Score'),
        this.lookups.get('MediaFormat'),
        this.lookups.get('ReleaseAudio'),
        this.lookups.get('ReleaseSubtitle'),
        this.lookups.get('ReleaseRegion'),
        this.lookups.get('ReleasePicture'),
        this.lookups.get('ReleaseCondition'),
        this.lookups.get('ReleasePublisher'),
        this.lookups.get('OwnershipType'),
      ]);
    this.scores = scores;
    this.mediaFormats = formats.filter((f) => f.Id > 0);
    this.mediaFormatLabelMap = Object.fromEntries(
      this.mediaFormats.map((f) => [f.Id, mediaFormatLong(f.Id) || String(f.Value)])
    );
    this.releaseAudios = audios;
    this.releaseSubtitles = this.sortSubtitles(subs);
    this.releaseRegions = regions.map((r) => ({
      ...r,
      Value: releaseRegionLabel(r.Value),
    }));
    this.releasePictures = pictures;
    this.releaseConditions = conditions;
    this.releasePublishers = this.sortLookupAlpha(publishers);
    this.ownershipTypes = this.sortLookupAlpha(types);
    await this.load();
  }

  private sortLookupAlpha(rows: LookupRow[]): LookupRow[] {
    return [...rows].sort((a, b) =>
      String(a.Value).localeCompare(String(b.Value), 'fi', { sensitivity: 'base' })
    );
  }

  private sortSubtitles(rows: LookupRow[]): LookupRow[] {
    const priority = (value: string | number): number => {
      const s = String(value).toLowerCase();
      if (s === 'finnish' || s === 'suomi') {
        return 0;
      }
      if (s === 'english' || s === 'englanti') {
        return 1;
      }
      return 2;
    };
    return [...rows].sort((a, b) => {
      const pa = priority(a.Value);
      const pb = priority(b.Value);
      if (pa !== pb) {
        return pa - pb;
      }
      return String(a.Value).localeCompare(String(b.Value), 'en', { sensitivity: 'base' });
    });
  }

  scoreLabel(id: number | null | undefined): string {
    return this.lookups.label(this.scores, id ?? 0);
  }

  scoreOptions(): LookupRow[] {
    return this.scores.filter((s) => s.Id > 0);
  }

  /** Display value for star rail (0–10, half steps). */
  displayScoreValue(): number {
    const id = this.hoverScoreId ?? this.scoreId;
    if (id == null) {
      return 0;
    }
    const row = this.scores.find((s) => s.Id === id);
    return row ? Number(row.Value) : 0;
  }

  starFill(star: number): number {
    const value = this.displayScoreValue();
    if (value >= star) {
      return 1;
    }
    if (value >= star - 0.5) {
      return 0.5;
    }
    return 0;
  }

  onStarLeave(): void {
    this.hoverScoreId = null;
  }

  onStarPointer(event: MouseEvent | PointerEvent, star: number, commit: boolean): void {
    if ('buttons' in event && event instanceof PointerEvent && event.type === 'pointermove' && event.buttons === 0) {
      // Hover preview only for mouse-like pointers.
      if (event.pointerType === 'touch') {
        return;
      }
    }
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const clientX =
      'clientX' in event
        ? event.clientX
        : (event as unknown as TouchEvent).touches?.[0]?.clientX ?? rect.left;
    const half = clientX - rect.left < rect.width / 2;
    const value = half ? star - 0.5 : star;
    const id = this.scoreIdForValue(value);
    if (commit) {
      this.scoreId = id;
      this.hoverScoreId = null;
    } else {
      this.hoverScoreId = id;
    }
  }

  private scoreIdForValue(value: number): number | null {
    const opts = this.scoreOptions();
    let best: LookupRow | null = null;
    let bestDiff = Infinity;
    for (const s of opts) {
      const diff = Math.abs(Number(s.Value) - value);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = s;
      }
    }
    return best?.Id ?? null;
  }

  rolesByType(roleName: string) {
    return this.details()?.roles.filter((r) => r.Role === roleName) ?? [];
  }

  roleNames(): string[] {
    return [...new Set((this.details()?.roles ?? []).map((r) => r.Role))];
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [details, reviews] = await Promise.all([
        this.movies.getDetails(this.movieId),
        this.userLinks.listForMovie(this.movieId),
      ]);
      this.details.set(details);
      this.reviews.set(reviews);
      if (!details) {
        this.error.set('Elokuvaa ei löytynyt.');
        return;
      }
      const me = this.auth.profile()?.Id;
      if (me) {
        const [mine, watch, owns] = await Promise.all([
          this.userLinks.getMine(this.movieId, me),
          this.watchlist.isOnWatchlist(this.movieId, me),
          this.ownershipApi.listForMovie(this.movieId, me),
        ]);
        this.scoreId = mine?.ScoreId && mine.ScoreId > 0 ? mine.ScoreId : null;
        this.reviewText = (mine?.Text ?? '').replace(/<br\s*\/?>/gi, '\n');
        this.onWatchlist.set(watch);
        this.ownerships.set(owns);
      } else {
        this.onWatchlist.set(false);
        this.ownerships.set([]);
      }
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openRating(): void {
    this.message.set(null);
    this.ratingOpen.set(true);
  }

  closeRating(): void {
    this.ratingOpen.set(false);
    this.hoverScoreId = null;
  }

  async saveRating(): Promise<void> {
    const userId = this.auth.profile()?.Id;
    if (!userId) {
      return;
    }
    this.saving.set(true);
    this.message.set(null);
    try {
      const text = this.reviewText.trim().replace(/\n/g, '<br />\n');
      await this.userLinks.save({
        MovieId: this.movieId,
        UserId: userId,
        ScoreId: this.scoreId ?? 0,
        Text: text,
      });
      this.reviews.set(await this.userLinks.listForMovie(this.movieId));
      this.ratingOpen.set(false);
    } catch (e: unknown) {
      this.message.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteRating(): Promise<void> {
    const userId = this.auth.profile()?.Id;
    if (!userId || !(await confirmAction('Poistetaanko arvio?'))) {
      return;
    }
    this.saving.set(true);
    try {
      await this.userLinks.remove(this.movieId, userId);
      this.scoreId = null;
      this.reviewText = '';
      this.reviews.set(await this.userLinks.listForMovie(this.movieId));
      this.ratingOpen.set(false);
    } catch (e: unknown) {
      this.message.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  averageScore(): string | null {
    const scored = this.reviews()
      .map((r) => {
        if (r.ScoreId == null || r.ScoreId <= 0) {
          return null;
        }
        const row = this.scores.find((s) => s.Id === r.ScoreId);
        return row ? Number(row.Value) : null;
      })
      .filter((v): v is number => v != null && !Number.isNaN(v));
    if (!scored.length) {
      return null;
    }
    const avg = scored.reduce((sum, v) => sum + v, 0) / scored.length;
    return (Math.round(avg * 10) / 10).toFixed(1);
  }

  formatBudget(value: number | string | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return '';
    }
    return n.toLocaleString('en-US');
  }

  hasBudget(): boolean {
    const n = Number(this.details()?.movie.Budget);
    return Number.isFinite(n) && n > 0;
  }

  runtimeLabel(): string {
    const movie = this.details()?.movie;
    if (!movie) {
      return '';
    }
    const ntsc = resolveNtscMinutes(movie.Ntsc, movie.Pal);
    if (ntsc == null) {
      return '';
    }
    return formatRuntimeMinutes(palMinutesFromNtsc(ntsc));
  }

  async toggleWatchlist(): Promise<void> {
    const userId = this.auth.profile()?.Id;
    if (!userId) {
      return;
    }
    try {
      if (this.onWatchlist()) {
        await this.watchlist.remove(this.movieId, userId);
        this.onWatchlist.set(false);
      } else {
        await this.watchlist.add(this.movieId, userId);
        this.onWatchlist.set(true);
      }
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    }
  }

  private emptyFormatDraft(mediaFormatId: number): OwnershipFormatDraft {
    return {
      mediaFormatId,
      releasePictureId: null,
      audioIds: [],
      subtitleIds: [],
    };
  }

  private emptyOwnershipDraft(seedMovie = true): OwnershipDraft {
    const d = this.details();
    const movies: OwnershipMovieDraft[] =
      seedMovie && d
        ? [
            {
              movieId: d.movie.Id,
              title: d.movie.Title,
              titleLanguageId: d.movie.TitleLanguageId,
              year: d.movie.Year,
              formatIds: [],
              formats: [],
            },
          ]
        : [];
    return {
      name: '',
      notes: '',
      releaseRegionId: this.releaseRegions[0]?.Id ?? null,
      releaseConditionId: 3, // Hyvä
      releasePublisherId: null,
      ownershipTypeId: null,
      movies,
    };
  }

  openNewOwnership(): void {
    if (!this.auth.isSuperUser()) {
      return;
    }
    this.ownershipMessage.set(null);
    this.ownershipDraft = this.emptyOwnershipDraft(true);
    this.closeMovieSearch();
    this.closeCatalogAdd();
    this.ownershipOpen.set(true);
  }

  async openEditOwnership(id: number): Promise<void> {
    if (!this.auth.isSuperUser()) {
      return;
    }
    this.ownershipMessage.set(null);
    const draft = await this.ownershipApi.getDraft(id);
    if (!draft) {
      return;
    }
    this.ownershipDraft = draft;
    this.closeMovieSearch();
    this.ownershipOpen.set(true);
  }

  closeOwnership(): void {
    this.closeMovieSearch();
    this.closeCatalogAdd();
    this.ownershipOpen.set(false);
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
    const existing = new Set(this.ownershipDraft.movies.map((m) => m.movieId));
    this.movieSearchResults = res.rows
      .filter((m) => !existing.has(m.Id))
      .map((m) => ({
        Id: m.Id,
        Title: m.Title,
        TitleLanguageId: m.TitleLanguageId,
        Year: m.Year,
      }));
  }

  addMovieToDraft(m: {
    Id: number;
    Title: string;
    TitleLanguageId: number | null;
    Year?: number | null;
  }): void {
    if (this.ownershipDraft.movies.some((x) => x.movieId === m.Id)) {
      return;
    }
    this.ownershipDraft.movies.push({
      movieId: m.Id,
      title: m.Title,
      titleLanguageId: m.TitleLanguageId,
      year: m.Year ?? null,
      formatIds: [],
      formats: [],
    });
    this.closeMovieSearch();
  }

  async removeMovieFromDraft(index: number): Promise<void> {
    if (!(await confirmAction('Poistetaanko elokuva tästä omistuksesta?'))) {
      return;
    }
    this.ownershipDraft.movies.splice(index, 1);
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
    movie.formats = nextIds.map((id) => keep.get(id) ?? this.emptyFormatDraft(id));
  }

  formatLabel(formatId: number): string {
    return this.mediaFormatLabelMap[formatId] || mediaFormatLong(formatId) || String(formatId);
  }

  openCatalogAdd(
    kind:
      | 'ReleaseAudio'
      | 'ReleaseSubtitle'
      | 'ReleasePicture'
      | 'ReleaseRegion'
      | 'ReleasePublisher'
      | 'OwnershipType',
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
      case 'ReleaseAudio':
        return 'Uusi ääniraita';
      case 'ReleaseSubtitle':
        return 'Uusi tekstitys';
      case 'ReleasePicture':
        return 'Uusi kuva';
      case 'ReleaseRegion':
        return 'Uusi versio';
      case 'ReleasePublisher':
        return 'Uusi julkaisija';
      case 'OwnershipType':
        return 'Uusi omistuksen tyyppi';
      default:
        return 'Uusi arvo';
    }
  }

  catalogAddPlaceholder(): string {
    switch (this.catalogAddKind) {
      case 'ReleaseAudio':
        return 'esim. Dolby Digital English 5.1';
      case 'ReleaseSubtitle':
        return 'esim. Finnish';
      case 'ReleasePicture':
        return 'esim. 1080p High Definition / 1.78:1 / 16x9';
      case 'ReleaseRegion':
        return 'esim. Australia';
      case 'ReleasePublisher':
        return 'esim. Arrow';
      case 'OwnershipType':
        return 'esim. Combo';
      default:
        return '';
    }
  }

  async deleteCatalogOption(
    kind: 'ReleaseAudio' | 'ReleaseSubtitle',
    opt: LookupRow
  ): Promise<void> {
    if (!(await confirmAction(`Poistetaanko "${opt.Value}" valintalistasta?`))) {
      return;
    }
    try {
      await this.ownershipApi.deleteCatalogValue(kind, opt.Id);
      this.lookups.invalidate(kind);
      if (kind === 'ReleaseAudio') {
        this.releaseAudios = await this.lookups.get('ReleaseAudio');
        for (const movie of this.ownershipDraft.movies) {
          for (const format of movie.formats) {
            format.audioIds = format.audioIds.filter((id) => id !== opt.Id);
          }
        }
      } else {
        this.releaseSubtitles = this.sortSubtitles(await this.lookups.get('ReleaseSubtitle'));
        for (const movie of this.ownershipDraft.movies) {
          for (const format of movie.formats) {
            format.subtitleIds = format.subtitleIds.filter((id) => id !== opt.Id);
          }
        }
      }
    } catch (e: unknown) {
      await showError(errorMessage(e));
    }
  }

  sortedLookups(rows: LookupRow[], selectedId: number | null | undefined): LookupRow[] {
    const selected = selectedId != null && selectedId > 0 ? new Set([selectedId]) : new Set<number>();
    const sel = rows.filter((r) => selected.has(r.Id));
    const rest = rows
      .filter((r) => !selected.has(r.Id))
      .sort((a, b) => String(a.Value).localeCompare(String(b.Value), 'fi', { sensitivity: 'base' }));
    return [...sel, ...rest];
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
        this.ownershipDraft.releaseRegionId = id;
      } else if (kind === 'ReleasePublisher') {
        this.releasePublishers = this.sortLookupAlpha(await this.lookups.get('ReleasePublisher'));
        this.ownershipDraft.releasePublisherId = id;
      } else if (kind === 'OwnershipType') {
        this.ownershipTypes = this.sortLookupAlpha(await this.lookups.get('OwnershipType'));
        this.ownershipDraft.ownershipTypeId = id;
      } else {
        const format =
          this.ownershipDraft.movies[this.catalogAddMovieIndex].formats[this.catalogAddFormatIndex];
        if (kind === 'ReleaseAudio') {
          this.releaseAudios = await this.lookups.get('ReleaseAudio');
          if (!format.audioIds.includes(id)) {
            format.audioIds = [...format.audioIds, id];
          }
        } else if (kind === 'ReleaseSubtitle') {
          this.releaseSubtitles = this.sortSubtitles(await this.lookups.get('ReleaseSubtitle'));
          if (!format.subtitleIds.includes(id)) {
            format.subtitleIds = [...format.subtitleIds, id];
          }
        } else {
          this.releasePictures = await this.lookups.get('ReleasePicture');
          format.releasePictureId = id;
        }
      }
      this.closeCatalogAdd();
    } catch (e: unknown) {
      this.catalogAddError = errorMessage(e);
    }
  }

  async deleteCurrentOwnership(): Promise<void> {
    const id = this.ownershipDraft.id;
    if (!id) {
      this.ownershipOpen.set(false);
      return;
    }
    const removed = await this.deleteOwnership(id);
    if (removed) {
      this.ownershipOpen.set(false);
    }
  }

  async saveOwnership(): Promise<void> {
    const userId = this.auth.profile()?.Id;
    if (!userId) {
      return;
    }
    this.saving.set(true);
    this.ownershipMessage.set(null);
    try {
      await this.ownershipApi.save(userId, this.ownershipDraft);
      this.ownerships.set(await this.ownershipApi.listForMovie(this.movieId, userId));
      this.ownershipOpen.set(false);
    } catch (e: unknown) {
      this.ownershipMessage.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteOwnership(id: number): Promise<boolean> {
    const userId = this.auth.profile()?.Id;
    if (!userId || !(await confirmAction('Poistetaanko tämä omistus?'))) {
      return false;
    }
    await this.ownershipApi.remove(id, userId);
    this.ownerships.set(await this.ownershipApi.listForMovie(this.movieId, userId));
    return true;
  }

  ownershipOptionLabel(o: OwnershipSummary): string {
    const formats = o.movies
      .flatMap((m) => m.formatLabels)
      .filter(Boolean)
      .join('+');
    const base = o.Name?.trim() || o.typeLabel || `Omistus #${o.Id}`;
    return formats ? `${base} (${formats})` : base;
  }

  openMergeOwnerships(): void {
    const list = this.ownerships();
    if (list.length < 2) {
      return;
    }
    this.mergeKeepId = list[0].Id;
    this.mergeAbsorbId = list[1].Id;
    this.mergeError = null;
    this.mergeOpen.set(true);
  }

  closeMergeOwnerships(): void {
    this.mergeOpen.set(false);
    this.mergeError = null;
  }

  async confirmMergeOwnerships(): Promise<void> {
    const userId = this.auth.profile()?.Id;
    if (!userId || this.mergeKeepId == null || this.mergeAbsorbId == null) {
      return;
    }
    if (this.mergeKeepId === this.mergeAbsorbId) {
      this.mergeError = 'Valitse kaksi eri omistusta.';
      return;
    }
    const keepLabel = this.ownershipOptionLabel(
      this.ownerships().find((o) => o.Id === this.mergeKeepId)!
    );
    const absorbLabel = this.ownershipOptionLabel(
      this.ownerships().find((o) => o.Id === this.mergeAbsorbId)!
    );
    if (
      !(await confirmAction(
        'Yhdistetäänkö omistukset?',
        `"${absorbLabel}" siirretään omistukseen "${keepLabel}" ja poistetaan.`,
        'Yhdistä'
      ))
    ) {
      return;
    }
    this.saving.set(true);
    this.mergeError = null;
    try {
      await this.ownershipApi.merge(userId, this.mergeKeepId, this.mergeAbsorbId);
      this.ownerships.set(await this.ownershipApi.listForMovie(this.movieId, userId));
      this.mergeOpen.set(false);
    } catch (e: unknown) {
      this.mergeError = errorMessage(e);
    } finally {
      this.saving.set(false);
    }
  }

  async deleteMovie(): Promise<void> {
    if (!(await confirmAction('Poistetaanko elokuva pysyvästi?'))) {
      return;
    }
    await this.movies.deleteMovie(this.movieId);
    await this.router.navigateByUrl('/');
  }
}
