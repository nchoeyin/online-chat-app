import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth/auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./auth/auth-page.component').then((m) => m.AuthPageComponent),
  },
  {
    // No guard: even if the user is briefly considered "authenticated" from a
    // stale localStorage entry, we still want them to land here to complete
    // the OAuth handshake.
    path: 'auth/callback',
    loadComponent: () =>
      import('./auth/auth-callback.component').then(
        (m) => m.AuthCallbackComponent,
      ),
  },
  // Backward-compat redirects so old links still work.
  { path: 'login', redirectTo: 'auth', pathMatch: 'full' },
  { path: 'signup', redirectTo: 'auth', pathMatch: 'full' },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./chat/chat-layout.component').then((m) => m.ChatLayoutComponent),
  },
  { path: '**', redirectTo: '' },
];
