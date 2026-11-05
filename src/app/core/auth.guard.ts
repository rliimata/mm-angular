import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Wait until session bootstrap finishes
  const started = Date.now();
  while (!auth.ready() && Date.now() - started < 5000) {
    await new Promise((r) => setTimeout(r, 50));
  }

  if (auth.isLoggedIn()) {
    return true;
  }
  return router.createUrlTree(['/login']);
};
