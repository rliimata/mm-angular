import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const superuserGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const started = Date.now();
  while (!auth.ready() && Date.now() - started < 5000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (auth.isLoggedIn() && auth.isSuperUser()) {
    return true;
  }
  return router.createUrlTree(['/']);
};
