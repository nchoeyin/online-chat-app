import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, extractErrorMessage } from './auth.service';

/**
 * Lands the user after a provider OAuth redirect, e.g.
 *   http://localhost:4200/auth/callback?code=...&state=...
 *
 * Extracts the code + state and POSTs them to the backend to finish the
 * exchange. On success, navigates to the original `returnUrl` (or `/`).
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `
    <div class="flex min-h-screen w-full items-center justify-center bg-neutral-50 px-4 py-12">
      <div class="w-full max-w-md rounded-3xl bg-white px-10 py-12 text-center shadow-xl">
        @if (error(); as msg) {
          <h2 class="text-[22px] font-normal text-neutral-900">Sign-in failed</h2>
          <p class="mt-3 text-sm text-red-600">{{ msg }}</p>
          <button
            type="button"
            (click)="backToAuth()"
            class="mt-8 h-12 w-full rounded-full bg-neutral-900 text-[15px] font-medium text-white transition hover:bg-neutral-800"
          >
            Back to sign-in
          </button>
        } @else {
          <h2 class="text-[22px] font-normal text-neutral-900">Finishing sign-in…</h2>
          <p class="mt-3 text-sm text-neutral-500">Hang tight, this only takes a second.</p>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallbackComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.complete();
  }

  private async complete(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const state = params.get('state');
    const providerError = params.get('error');
    const returnUrl = params.get('returnUrl') ?? '/';

    if (providerError) {
      this.error.set(
        `Google returned an error: ${params.get('error_description') ?? providerError}`,
      );
      return;
    }

    if (!code || !state) {
      this.error.set('Missing authorization code or state in the callback URL.');
      return;
    }

    try {
      // Currently only Google is wired up; expand this when adding providers.
      await this.auth.oauthComplete('google', code, state);
      await this.router.navigateByUrl(returnUrl);
    } catch (err) {
      this.error.set(
        extractErrorMessage(err, 'Could not complete sign-in. Please try again.'),
      );
    }
  }

  protected backToAuth(): void {
    void this.router.navigateByUrl('/auth');
  }
}
