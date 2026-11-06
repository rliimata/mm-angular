import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { superuserGuard } from './core/superuser.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'movie/new',
    canActivate: [authGuard, superuserGuard],
    loadComponent: () => import('./pages/movie-edit/movie-edit.page').then((m) => m.MovieEditPage),
  },
  {
    path: 'movie/:id/edit',
    canActivate: [authGuard, superuserGuard],
    loadComponent: () => import('./pages/movie-edit/movie-edit.page').then((m) => m.MovieEditPage),
  },
  {
    path: 'movie/:movieId/ownership/new',
    canActivate: [authGuard, superuserGuard],
    loadComponent: () =>
      import('./pages/ownership-edit/ownership-edit.page').then((m) => m.OwnershipEditPage),
  },
  {
    path: 'movie/:movieId/ownership/:ownershipId/edit',
    canActivate: [authGuard, superuserGuard],
    loadComponent: () =>
      import('./pages/ownership-edit/ownership-edit.page').then((m) => m.OwnershipEditPage),
  },
  {
    path: 'movie/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/movie-detail/movie-detail.page').then((m) => m.MovieDetailPage),
  },
  {
    path: 'person/new',
    canActivate: [authGuard, superuserGuard],
    loadComponent: () => import('./pages/person-edit/person-edit.page').then((m) => m.PersonEditPage),
  },
  {
    path: 'person/:id/edit',
    canActivate: [authGuard, superuserGuard],
    loadComponent: () => import('./pages/person-edit/person-edit.page').then((m) => m.PersonEditPage),
  },
  {
    path: 'person/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/person-detail/person-detail.page').then((m) => m.PersonDetailPage),
  },
  { path: '**', redirectTo: '' },
];
