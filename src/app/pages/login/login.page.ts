import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  email = '';
  password = '';
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  async submit(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const { error } = await this.auth.signIn(this.email.trim(), this.password);
      if (error) {
        this.error.set(error);
        return;
      }
      if (!this.auth.profile()) {
        this.error.set(
          'Kirjautuminen onnistui, mutta profiilia ei ole linkitetty. Liitä AuthUserId User-tauluun.'
        );
        await this.auth.signOut();
        return;
      }
      await this.router.navigateByUrl('/');
    } finally {
      this.busy.set(false);
    }
  }
}
