import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiService } from './ui.service';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './auth-modal.component.html',
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthModalComponent {
  protected readonly ui = inject(UiService);
  protected readonly email = signal('');

  constructor() {
    effect(() => {
      if (typeof document === 'undefined') return;
      document.body.style.overflow = this.ui.authModalOpen() ? 'hidden' : '';
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.ui.authModalOpen()) this.ui.closeAuth();
  }

  protected onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.ui.closeAuth();
  }

  protected continueWith(provider: 'google' | 'apple' | 'phone' | 'email'): void {
    if (provider === 'email' && !this.email().trim()) return;
    console.log('[auth] continue with', provider, this.email());
    this.ui.closeAuth();
    this.email.set('');
  }
}
