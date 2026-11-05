import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { confirmAction } from '../../core/confirm.util';
import { DetailRefreshService } from '../../core/detail-refresh.service';
import { errorMessage } from '../../core/error.util';
import {
  ageRatingImageSrc,
  ageRatingLabel,
  formatRuntimeMinutes,
  palMinutesFromNtsc,
  resolveNtscMinutes,
  swapNames,
  swapTitle,
  titleWithYear,
} from '../../core/format.util';
import { LookupRow } from '../../core/models';
import { LookupService } from '../../data/lookup.service';
import { MovieDetails, MovieService } from '../../data/movie.service';
import { OwnershipService, OwnershipSummary } from '../../data/ownership.service';
import { UserLinkService } from '../../data/user-link.service';
import { MemolistService } from '../../data/memolist.service';
import { WatchlistService } from '../../data/watchlist.service';
import { MediaImageComponent } from '../../shared/media-image.component';
import {
  OwnershipEditModal,
  OwnershipSeedMovie,
} from '../modals/ownership-edit/ownership-edit.modal';
import { SearchSelectComponent } from '../../shared/search-select.component';

@Component({
  selector: 'app-movie-detail',
  standalone: true,
  imports: [RouterLink, FormsModule, MediaImageComponent, OwnershipEditModal, SearchSelectComponent],
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
  readonly onMemolist = signal(false);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly message = signal<string | null>(null);
  readonly ratingOpen = signal(false);
  readonly ownershipOpen = signal(false);
  readonly editingOwnershipId = signal<number | null>(null);
  /** Snapshot taken when opening the modal — must stay referentially stable. */
  ownershipSeed: OwnershipSeedMovie | null = null;
  readonly mergeOpen = signal(false);
  mergeKeepId: number | null = null;
  mergeAbsorbId: number | null = null;
  mergeError: string | null = null;

  scoreId: number | null = null;
  hoverScoreId: number | null = null;
  reviewText = '';
  scores: LookupRow[] = [];

  readonly swapNames = swapNames;
  readonly swapTitle = swapTitle;
  readonly titleWithYear = titleWithYear;
  readonly ageLabel = ageRatingLabel;
  readonly ageImageSrc = ageRatingImageSrc;

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
    private readonly memolist: MemolistService,
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
    this.scores = await this.lookups.get('Score');
    await this.load();
  }

  scoreLabel(id: number | null | undefined): string {
    return this.lookups.label(this.scores, id ?? 0);
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

  private snapshotSeedMovie(): OwnershipSeedMovie | null {
    const d = this.details();
    if (!d) {
      return null;
    }
    return {
      Id: d.movie.Id,
      Title: d.movie.Title,
      TitleLanguageId: d.movie.TitleLanguageId,
      Year: d.movie.Year,
      RatioId: d.movie.RatioId,
    };
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
        const [mine, watch, memo, owns] = await Promise.all([
          this.userLinks.getMine(this.movieId, me),
          this.watchlist.isOnWatchlist(this.movieId, me),
          this.memolist.isOnMemolist(this.movieId, me),
          this.ownershipApi.listForMovie(this.movieId, me),
        ]);
        this.scoreId = mine?.ScoreId && mine.ScoreId > 0 ? mine.ScoreId : null;
        this.reviewText = (mine?.Text ?? '').replace(/<br\s*\/?>/gi, '\n');
        this.onWatchlist.set(watch);
        this.onMemolist.set(memo);
        this.ownerships.set(owns);
      } else {
        this.onWatchlist.set(false);
        this.onMemolist.set(false);
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

  async toggleMemolist(): Promise<void> {
    const userId = this.auth.profile()?.Id;
    if (!userId) {
      return;
    }
    try {
      if (this.onMemolist()) {
        await this.memolist.remove(this.movieId, userId);
        this.onMemolist.set(false);
      } else {
        await this.memolist.add(this.movieId, userId);
        this.onMemolist.set(true);
      }
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    }
  }

  imageSearchQuery(): string {
    const d = this.details();
    if (!d) {
      return '';
    }
    const parts = [
      swapTitle(d.movie.Title, d.movie.TitleLanguageId).replace(/\s+/g, ' ').trim(),
      d.movie.Year != null ? String(d.movie.Year) : '',
    ];
    if (d.version) {
      parts.push(d.version);
    }
    parts.push('poster');
    return parts.filter(Boolean).join(' ');
  }

  openNewOwnership(): void {
    if (!this.auth.isSuperUser()) {
      return;
    }
    this.ownershipSeed = this.snapshotSeedMovie();
    this.editingOwnershipId.set(null);
    this.ownershipOpen.set(true);
  }

  openEditOwnership(id: number): void {
    if (!this.auth.isSuperUser()) {
      return;
    }
    this.ownershipSeed = this.snapshotSeedMovie();
    this.editingOwnershipId.set(id);
    this.ownershipOpen.set(true);
  }

  closeOwnership(): void {
    this.ownershipOpen.set(false);
    this.editingOwnershipId.set(null);
    this.ownershipSeed = null;
  }

  async onOwnershipChanged(): Promise<void> {
    const userId = this.auth.profile()?.Id;
    if (!userId) {
      return;
    }
    this.ownerships.set(await this.ownershipApi.listForMovie(this.movieId, userId));
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

  ownershipSelectOptions(): LookupRow[] {
    return this.ownerships().map((o) => ({ Id: o.Id, Value: this.ownershipOptionLabel(o) }));
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
