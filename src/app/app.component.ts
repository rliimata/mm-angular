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
import { UserAdminService } from './data/user-admin.service';
import { ListPreviewComponent } from './shared/list-preview.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, ListPreviewComponent, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  @ViewChild('passwordNewInput') private passwordNewInput?: ElementRef<HTMLInputElement>;
  @ViewChild('userFirstNameInput') private userFirstNameInput?: ElementRef<HTMLInputElement>;

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

  readonly catalogCounts = signal<{ movies: number; people: number } | null>(null);

  constructor(
    readonly auth: AuthService,
    private readonly router: Router,
    private readonly moviesApi: MovieService,
    private readonly peopleApi: PersonService,
    private readonly usersApi: UserAdminService,
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
}

function isValidEmail(value: string): boolean {
  // Practical check: local@domain.tld (no spaces)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
