import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
}

export interface CheckResult {
  exists: boolean;
  method: string;
}

const STORAGE_KEY = 'copilot.auth.v1';

interface PersistedAuth {
  user: AuthUser | null;
}

function readPersisted(): PersistedAuth {
  if (typeof localStorage === 'undefined') return { user: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null };
    const parsed = JSON.parse(raw) as PersistedAuth;
    return { user: parsed?.user ?? null };
  } catch {
    return { user: null };
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/auth`;

  // Cookies (sessionid) are HttpOnly on the Django side, so the browser sends
  // them automatically when `withCredentials: true` is set on every request.
  private readonly httpOpts = { withCredentials: true } as const;

  private readonly _user = signal<AuthUser | null>(readPersisted().user);

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  constructor() {
    effect(() => {
      if (typeof localStorage === 'undefined') return;
      const next: PersistedAuth = { user: this._user() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    });

    // Background-validate the session on boot. If localStorage says we're
    // logged in but the Django session has expired, clear the stale state.
    if (this._user() !== null) {
      void this.refresh();
    }
  }

  async checkAccount(email: string): Promise<CheckResult> {
    return await firstValueFrom(
      this.http.post<CheckResult>(`${this.base}/check`, { email }, this.httpOpts),
    );
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const user = await firstValueFrom(
      this.http.post<AuthUser>(
        `${this.base}/login`,
        { email, password },
        this.httpOpts,
      ),
    );
    this._user.set(user);
    return user;
  }

  async signup(email: string, password: string, name?: string): Promise<AuthUser> {
    const user = await firstValueFrom(
      this.http.post<AuthUser>(
        `${this.base}/signup`,
        { email, password, name },
        this.httpOpts,
      ),
    );
    this._user.set(user);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.base}/logout`, {}, this.httpOpts),
      );
    } finally {
      this._user.set(null);
    }
  }

  /**
   * Kick off an OAuth flow for the given provider. Returns the URL the browser
   * should navigate to (the caller does the redirect via `window.location`).
   */
  async oauthStart(provider: 'google'): Promise<string> {
    const { authorize_url } = await firstValueFrom(
      this.http.post<{ authorize_url: string }>(
        `${this.base}/oauth/${provider}/start`,
        {},
        this.httpOpts,
      ),
    );
    return authorize_url;
  }

  /**
   * Finish an OAuth flow: send the `code` + `state` returned by the provider
   * to the backend, which exchanges them for a real session.
   */
  async oauthComplete(
    provider: 'google',
    code: string,
    state: string,
  ): Promise<AuthUser> {
    const user = await firstValueFrom(
      this.http.post<AuthUser>(
        `${this.base}/oauth/${provider}/complete`,
        { code, state },
        this.httpOpts,
      ),
    );
    this._user.set(user);
    return user;
  }

  /**
   * Re-fetch the current user from the server. If the session is invalid,
   * clear the local cache so the auth guard kicks in.
   */
  async refresh(): Promise<AuthUser | null> {
    try {
      const user = await firstValueFrom(
        this.http.get<AuthUser>(`${this.base}/me`, this.httpOpts),
      );
      this._user.set(user);
      return user;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        this._user.set(null);
      }
      return null;
    }
  }
}

/**
 * Pull a human-readable error message out of an HttpErrorResponse from the
 * Django Ninja backend (which uses {"detail": "..."}).
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail) return detail;
    }
    if (err.status === 0) return 'Cannot reach the server. Is it running?';
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
