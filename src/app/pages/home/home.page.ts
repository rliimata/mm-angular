import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error.util';
import { formatMovieListTitle, swapNames, titleWithYear } from '../../core/format.util';
import { LookupRow, Person } from '../../core/models';
import { getSupabase } from '../../core/supabase.client';
import { LookupService } from '../../data/lookup.service';
import { MovieListItem, MovieSearchMode, MovieService } from '../../data/movie.service';
import { OwnershipService, OwnershipSummary } from '../../data/ownership.service';
import { PersonService } from '../../data/person.service';

export type HomeMode = MovieSearchMode | 'birthdays';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage implements OnInit {
  query = '';
  mode: HomeMode = 'text';
  filterUserId: number | null = null;
  page = 1;
  readonly pageSize = 50;

  readonly movies = signal<MovieListItem[]>([]);
  readonly people = signal<Person[]>([]);
  readonly ownerships = signal<OwnershipSummary[]>([]);
  readonly total = signal(0);
  readonly ownershipTotal = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  users: { Id: number; Name: string }[] = [];
  scores: LookupRow[] = [];

  movieTitle(m: MovieListItem): string {
    return formatMovieListTitle({
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

  ownershipLabel(o: OwnershipSummary): string {
    if (o.Name?.trim()) {
      return o.Name;
    }
    const movies = o.movies
      .map((m) => titleWithYear(m.Title, m.TitleLanguageId, m.Year))
      .filter(Boolean);
    return movies.join(', ') || `Omistus #${o.Id}`;
  }

  constructor(
    readonly auth: AuthService,
    private readonly moviesApi: MovieService,
    private readonly peopleApi: PersonService,
    private readonly ownershipApi: OwnershipService,
    private readonly lookups: LookupService
  ) {}

  async ngOnInit(): Promise<void> {
    this.filterUserId = this.auth.profile()?.Id ?? null;
    this.scores = await this.lookups.get('Score');
    this.users = await this.loadUsers();
    await this.runSearch();
  }

  private async loadUsers(): Promise<{ Id: number; Name: string }[]> {
    const { data, error } = await getSupabase()
      .from('Profile')
      .select('Id, FirstName, LastName')
      .order('LastName')
      .order('FirstName');
    if (error) {
      console.error(error);
    }
    return ((data as { Id: number; FirstName: string; LastName: string }[]) ?? []).map((u) => ({
      Id: u.Id,
      Name: [u.FirstName, u.LastName].filter(Boolean).join(' ') || `User ${u.Id}`,
    }));
  }

  get totalPages(): number {
    if (this.mode === 'owned') {
      return Math.max(1, Math.ceil(this.ownershipTotal() / this.pageSize));
    }
    if (this.mode === 'birthdays') {
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
    if ((mode === 'rated' || mode === 'owned' || mode === 'watchlist') && !this.filterUserId) {
      this.filterUserId = this.auth.profile()?.Id ?? null;
    }
    void this.runSearch();
  }

  async runSearch(resetPage = true): Promise<void> {
    if (resetPage) {
      this.page = 1;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      if (this.mode === 'birthdays') {
        this.movies.set([]);
        this.ownerships.set([]);
        this.ownershipTotal.set(0);
        this.total.set(0);
        const rows = await this.peopleApi.listBirthdaysToday();
        this.people.set(rows);
        return;
      }

      if (this.mode === 'owned') {
        this.movies.set([]);
        this.people.set([]);
        if (!this.filterUserId) {
          this.ownerships.set([]);
          this.ownershipTotal.set(0);
          return;
        }
        const res = await this.ownershipApi.listForUser(this.filterUserId, this.page, this.pageSize);
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
        userId: this.filterUserId,
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
}
