import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { showInfo } from './core/confirm.util';
import { ListPreviewComponent } from './shared/list-preview.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, ListPreviewComponent, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  @ViewChild('passwordNewInput') private passwordNewInput?: ElementRef<HTMLInputElement>;

  readonly passwordOpen = signal(false);
  readonly passwordSaving = signal(false);
  readonly passwordError = signal<string | null>(null);
  passwordNew = '';
  passwordConfirm = '';

  constructor(
    readonly auth: AuthService,
    private readonly router: Router
  ) {}

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
}
