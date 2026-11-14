import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { showInfo } from './core/confirm.util';
import { DetailRefreshService } from './core/detail-refresh.service';
import { errorMessage } from './core/error.util';
import { MovieService } from './data/movie.service';
import { PersonService } from './data/person.service';
import { TmdbSearchResult, TmdbService } from './data/tmdb.service';
import { UserAdminService } from './data/user-admin.service';
import { DigitsOnlyDirective } from './shared/digits-only.directive';
import { ListPreviewComponent } from './shared/list-preview.component';
import { SentenceCaseDirective } from './shared/sentence-case.directive';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    ListPreviewComponent,
    FormsModule,
    DigitsOnlyDirective,
    SentenceCaseDirective,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  @ViewChild('passwordNewInput') private passwordNewInput?: ElementRef<HTMLInputElement>;
  @ViewChild('userFirstNameInput') private userFirstNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('newMovieTitleInput') private newMovieTitleInput?: ElementRef<HTMLInputElement>;

  private readonly destroyRef = inject(DestroyRef);

  readonly passwordOpen = signal(false);
  readonly passwordSaving = signal(false);
  readonly passwordError = signal<string | null>(null);
  passwordNew = '';
  passwordConfirm = '';

  readonly userOpen = signal(false);
  readonly userSaving = signal(false);
  readonly userError = signal<string | null>(null);
  userEmail = '';
  userPassword = '';
  userFirstName = '';
  userLastName = '';

  readonly newMovieOpen = signal(false);
  readonly newMovieBusy = signal(false);
  readonly newMovieError = signal<string | null>(null);
  readonly newMovieHits = signal<TmdbSearchResult[]>([]);
  newMovieTitle = '';
  newMovieYear = '';

  readonly catalogCounts = signal<{ movies: number; people: number } | null>(null);

  constructor(
    readonly auth: AuthService,
    private readonly router: Router,
    private readonly moviesApi: MovieService,
    private readonly peopleApi: PersonService,
    private readonly usersApi: UserAdminService,
    private readonly tmdb: TmdbService,
    private readonly detailRefresh: DetailRefreshService
  ) {}

  ngOnInit(): void {
    void this.refreshCatalogCounts();
    this.detailRefresh
      .onCatalogCounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.refreshCatalogCounts());
  }

  private async refreshCatalogCounts(): Promise<void> {
    try {
      const [movies, people] = await Promise.all([
        this.moviesApi.countAll(),
        this.peopleApi.countAll(),
      ]);
      this.catalogCounts.set({ movies, people });
    } catch {
      // Counts are informational.
    }
  }

  async logout(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }

  openPasswordChange(): void {
    this.passwordNew = '';
    this.passwordConfirm = '';
    this.passwordError.set(null);
    this.passwordOpen.set(true);
    setTimeout(() => this.passwordNewInput?.nativeElement.focus(), 0);
  }

  closePasswordChange(): void {
    this.passwordOpen.set(false);
    this.passwordSaving.set(false);
    this.passwordError.set(null);
    this.passwordNew = '';
    this.passwordConfirm = '';
  }

  async savePassword(): Promise<void> {
    this.passwordError.set(null);
    if (this.passwordNew !== this.passwordConfirm) {
      this.passwordError.set('Salasanat eivät täsmää.');
      return;
    }
    this.passwordSaving.set(true);
    try {
      const { error } = await this.auth.changePassword(this.passwordNew);
      if (error) {
        this.passwordError.set(error);
        return;
      }
      this.closePasswordChange();
      await showInfo('Salasana tallennettu.');
    } finally {
      this.passwordSaving.set(false);
    }
  }

  openCreateUser(): void {
    this.userEmail = '';
    this.userPassword = '';
    this.userFirstName = '';
    this.userLastName = '';
    this.userError.set(null);
    this.userOpen.set(true);
    setTimeout(() => this.userFirstNameInput?.nativeElement.focus(), 0);
  }

  closeCreateUser(): void {
    this.userOpen.set(false);
    this.userSaving.set(false);
    this.userError.set(null);
    this.userEmail = '';
    this.userPassword = '';
    this.userFirstName = '';
    this.userLastName = '';
  }

  async saveCreateUser(): Promise<void> {
    this.userError.set(null);
    const email = this.userEmail.trim();
    if (!isValidEmail(email)) {
      this.userError.set('Anna kelvollinen sähköpostiosoite.');
      return;
    }
    this.userSaving.set(true);
    try {
      await this.usersApi.createUser({
        email,
        password: this.userPassword,
        firstName: this.userFirstName,
        lastName: this.userLastName,
      });
      this.closeCreateUser();
      await showInfo('Käyttäjä luotu.');
    } catch (e: unknown) {
      this.userError.set(errorMessage(e));
    } finally {
      this.userSaving.set(false);
    }
  }

  openNewMovie(): void {
    this.newMovieTitle = '';
    this.newMovieYear = '';
    this.newMovieError.set(null);
    this.newMovieHits.set([]);
    this.newMovieBusy.set(false);
    this.newMovieOpen.set(true);
    setTimeout(() => this.newMovieTitleInput?.nativeElement.focus(), 0);
  }

  closeNewMovie(): void {
    if (this.newMovieBusy()) {
      return;
    }
    this.newMovieOpen.set(false);
    this.newMovieBusy.set(false);
    this.newMovieError.set(null);
    this.newMovieHits.set([]);
    this.newMovieTitle = '';
    this.newMovieYear = '';
  }

  backNewMovieForm(): void {
    this.newMovieHits.set([]);
    this.newMovieError.set(null);
    setTimeout(() => this.newMovieTitleInput?.nativeElement.focus(), 0);
  }

  async startNewMovieBlank(): Promise<void> {
    const title = this.newMovieTitle.trim();
    const year = this.newMovieYear.trim();
    const queryParams: Record<string, string> = {};
    if (title) {
      queryParams['title'] = title;
    }
    if (/^\d{4}$/.test(year)) {
      queryParams['year'] = year;
    }
    this.closeNewMovie();
    await this.navigateToNewMovie(queryParams);
  }

  async startNewMovieTmdb(): Promise<void> {
    const title = this.newMovieTitle.trim();
    if (!title || this.newMovieBusy()) {
      return;
    }
    this.newMovieBusy.set(true);
    this.newMovieError.set(null);
    try {
      const yearRaw = this.newMovieYear.trim();
      const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
      const res = await this.tmdb.searchMovies(title, year);
      const hits = res.results ?? [];
      if (!hits.length) {
        this.newMovieError.set('Ei osumia TMDB:ssä.');
        return;
      }
      if (hits.length === 1) {
        await this.goNewMovieWithTmdb(hits[0].id);
        return;
      }
      this.newMovieHits.set(hits);
    } catch (e: unknown) {
      this.newMovieError.set(errorMessage(e));
    } finally {
      this.newMovieBusy.set(false);
    }
  }

  async selectNewMovieTmdb(hit: TmdbSearchResult): Promise<void> {
    if (this.newMovieBusy()) {
      return;
    }
    this.newMovieBusy.set(true);
    this.newMovieError.set(null);
    try {
      await this.goNewMovieWithTmdb(hit.id);
    } catch (e: unknown) {
      this.newMovieError.set(errorMessage(e));
      this.newMovieBusy.set(false);
    }
  }

  private async goNewMovieWithTmdb(tmdbId: number): Promise<void> {
    this.newMovieOpen.set(false);
    this.newMovieBusy.set(false);
    this.newMovieHits.set([]);
    this.newMovieError.set(null);
    this.newMovieTitle = '';
    this.newMovieYear = '';
    await this.navigateToNewMovie({ tmdb: String(tmdbId) });
  }

  /** Remount edit page when already on /movie/new so query seed runs again. */
  private async navigateToNewMovie(queryParams: Record<string, string>): Promise<void> {
    if (this.router.url.split('?')[0] === '/movie/new') {
      await this.router.navigateByUrl('/', { skipLocationChange: true });
    }
    await this.router.navigate(['/movie/new'], { queryParams });
  }
}

function isValidEmail(value: string): boolean {
  // Practical check: local@domain.tld (no spaces)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
