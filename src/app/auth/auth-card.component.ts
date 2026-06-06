import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, extractErrorMessage } from './auth.service';

type Step = 'email' | 'password';
type Branch = 'login' | 'signup';

@Component({
  selector: 'app-auth-card',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './auth-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCardComponent {
  private readonly auth = inject(AuthService);

  @Input() showClose = false;

  @Output() close = new EventEmitter<void>();
  @Output() authenticated = new EventEmitter<void>();

  protected readonly step = signal<Step>('email');
  protected readonly branch = signal<Branch>('login');

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly name = signal('');

  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected readonly title = computed(() => {
    if (this.step() === 'email') return 'Log in or sign up';
    return this.branch() === 'signup' ? 'Create your account' : 'Welcome back';
  });

  protected readonly subtitle = computed(() => {
    if (this.step() === 'email') {
      return "You'll get smarter responses and can upload files, images, and more.";
    }
    return this.branch() === 'signup'
      ? `Set a password for ${this.email()} to finish signing up.`
      : `Enter your password for ${this.email()} to continue.`;
  });

  protected readonly submitLabel = computed(() => {
    if (this.submitting()) return 'Please wait…';
    if (this.step() === 'email') return 'Continue';
    return this.branch() === 'signup' ? 'Create account' : 'Log in';
  });

  protected onClose(): void {
    this.close.emit();
  }

  protected useDifferentEmail(): void {
    this.step.set('email');
    this.branch.set('login');
    this.password.set('');
    this.name.set('');
    this.error.set(null);
  }

  protected async continueWithProvider(
    provider: 'google' | 'apple' | 'phone',
  ): Promise<void> {
    if (this.submitting()) return;

    if (provider !== 'google') {
      this.error.set(`Sign in with ${provider} isn't wired up yet.`);
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    try {
      const authorizeUrl = await this.auth.oauthStart('google');
      // Full-page redirect; the user will come back to /auth/callback
      // where AuthCallbackComponent finishes the flow.
      window.location.href = authorizeUrl;
    } catch (err) {
      this.error.set(
        extractErrorMessage(
          err,
          'Could not start Google sign-in. Please try again.',
        ),
      );
      this.submitting.set(false);
    }
  }

  protected async onSubmit(): Promise<void> {
    if (this.submitting()) return;

    if (this.step() === 'email') {
      await this.handleEmailStep();
    } else {
      await this.handlePasswordStep();
    }
  }

  private async handleEmailStep(): Promise<void> {
    const email = this.email().trim();
    if (!email) return;

    this.error.set(null);
    this.submitting.set(true);
    try {
      const { exists } = await this.auth.checkAccount(email);
      this.branch.set(exists ? 'login' : 'signup');
      this.step.set('password');
    } catch (err) {
      this.error.set(extractErrorMessage(err, 'Could not check that email.'));
    } finally {
      this.submitting.set(false);
    }
  }

  private async handlePasswordStep(): Promise<void> {
    const email = this.email().trim();
    const password = this.password();
    if (!email || !password) return;

    this.error.set(null);
    this.submitting.set(true);
    try {
      if (this.branch() === 'signup') {
        if (password.length < 6) {
          this.error.set('Password must be at least 6 characters.');
          return;
        }
        await this.auth.signup(email, password, this.name().trim() || undefined);
      } else {
        await this.auth.login(email, password);
      }
      this.authenticated.emit();
    } catch (err) {
      this.error.set(extractErrorMessage(err, 'Something went wrong.'));
    } finally {
      this.submitting.set(false);
    }
  }
}
