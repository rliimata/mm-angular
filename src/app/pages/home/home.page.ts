import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error.util';
import { parseAppDateTime } from '../../core/datetime.util';
import {
  formatMovieListTitleParts,
  MovieListTitleParts,
  swapNames,
} from '../../core/format.util';
import { PageTitleService } from '../../core/page-title.service';
import { LookupRow, Person } from '../../core/models';
import { LookupService } from '../../data/lookup.service';
import { MovieListItem, MovieSearchMode, MovieService } from '../../data/movie.service';
import {
  ownershipListLabel,
  OwnershipService,
  OwnershipSummary,
} from '../../data/ownership.service';
import { PersonService } from '../../data/person.service';

export type HomeMode = MovieSearchMode | 'birthdays' | 'shelf';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage implements OnInit, AfterViewInit {
  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  query = '';
  mode: HomeMode = 'text';
  page = 1;
  readonly pageSize = 50;

  readonly movies = signal<MovieListItem[]>([]);
  readonly people = signal<Person[]>([]);
  readonly ownerships = signal<OwnershipSummary[]>([]);
  readonly total = signal(0);
  readonly ownershipTotal = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  scores: LookupRow[] = [];

  movieTitleParts(m: MovieListItem): MovieListTitleParts {
    return formatMovieListTitleParts({
      title: m.Title,
      titleLanguageId: m.TitleLanguageId,
      year: m.Year,
      distributionId: m.DistributionId,
      version: m.VersionLabel,
      finnishTitle: m.FinnishTitle,
    });
  }

  personName(p: Person): string {
    return swapNames(p.Name);
  }

  /** Age turning today, e.g. ", 42". */
  birthdayAgeSuffix(p: Person): string {
    const birth = parseAppDateTime(p.BirthDate);
    if (!birth?.year || birth.year <= 0) {
      return '';
    }
    const age = new Date().getFullYear() - birth.year;
    return age >= 0 ? `, ${age}` : '';
  }

  ownershipLabel(o: OwnershipSummary): string {
    return ownershipListLabel(o);
  }

  constructor(
    readonly auth: AuthService,
    private readonly router: Router,
    private readonly moviesApi: MovieService,
    private readonly peopleApi: PersonService,
    private readonly ownershipApi: OwnershipService,
    private readonly lookups: LookupService,
    private readonly pageTitle: PageTitleService
  ) {}

  async ngOnInit(): Promise<void> {
    this.pageTitle.set('Haku');
    this.scores = await this.lookups.get('Score');
    await this.runSearch();
    this.focusSearchInput();
  }

  ngAfterViewInit(): void {
    this.focusSearchInput();
  }

  private focusSearchInput(): void {
    if (this.mode !== 'text') {
      return;
    }
    queueMicrotask(() => this.searchInput?.nativeElement.focus());
  }

  private currentUserId(): number | null {
    return this.auth.profile()?.Id ?? null;
  }

  get totalPages(): number {
    if (this.mode === 'owned') {
      return Math.max(1, Math.ceil(this.ownershipTotal() / this.pageSize));
    }
    if (this.mode === 'birthdays' || this.mode === 'shelf') {
      return 1;
    }
    return Math.max(1, Math.ceil(this.total() / this.pageSize));
  }

  formatAvgScore(avg: number): string {
    return (Math.round(avg * 10) / 10).toFixed(1);
  }

  scoreLabel(scoreId: number | null | undefined): string {
    if (scoreId == null || scoreId === 0) {
      return '';
    }
    return this.lookups.label(this.scores, scoreId);
  }

  setMode(mode: HomeMode): void {
    this.mode = mode;
    void this.runSearch().then(() => this.focusSearchInput());
  }

  async runSearch(resetPage = true): Promise<void> {
    if (resetPage) {
      this.page = 1;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const userId = this.currentUserId();

      if (this.mode === 'birthdays') {
        this.movies.set([]);
        this.ownerships.set([]);
        this.ownershipTotal.set(0);
        this.total.set(0);
        const rows = await this.peopleApi.listBirthdaysToday();
        this.people.set(rows);
        return;
      }

      if (this.mode === 'shelf') {
        this.movies.set([]);
        this.people.set([]);
        this.ownerships.set([]);
        this.ownershipTotal.set(0);
        this.total.set(0);
        return;
      }

      if (this.mode === 'owned') {
        this.movies.set([]);
        this.people.set([]);
        if (!userId) {
          this.ownerships.set([]);
          this.ownershipTotal.set(0);
          return;
        }
        const res = await this.ownershipApi.listForUser(userId, this.page, this.pageSize);
        this.ownerships.set(res.rows);
        this.ownershipTotal.set(res.count);
        this.total.set(0);
        return;
      }

      this.ownerships.set([]);
      this.ownershipTotal.set(0);

      const moviePromise = this.moviesApi.search({
        query: this.mode === 'text' ? this.query : '',
        mode: this.mode,
        userId,
        page: this.page,
        pageSize: this.pageSize,
      });

      const peoplePromise =
        this.mode === 'text' && this.query.trim()
          ? this.peopleApi.search(this.query, 1, 30)
          : Promise.resolve({ rows: [] as Person[], count: 0 });

      const [movieRes, peopleRes] = await Promise.all([moviePromise, peoplePromise]);
      this.movies.set(movieRes.rows);
      this.total.set(movieRes.count);
      this.people.set(peopleRes.rows);
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async go(page: number): Promise<void> {
    this.page = Math.min(Math.max(1, page), this.totalPages);
    await this.runSearch(false);
  }

  async rollShelfMovie(): Promise<void> {
    if (this.mode !== 'shelf') {
      return;
    }
    const userId = this.currentUserId();
    if (!userId) {
      this.error.set('Kirjaudu sisään arvotaksesi.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const movieId = await this.ownershipApi.pickRandomShelfMovieId(userId);
      if (movieId == null) {
        this.error.set('Ei arvottavaa elokuvaa.');
        return;
      }
      await this.router.navigate(['/movie', movieId]);
    } catch (e: unknown) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
