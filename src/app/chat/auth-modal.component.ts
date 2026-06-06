import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  effect,
  inject,
} from '@angular/core';
import { AuthCardComponent } from '../auth/auth-card.component';
import { UiService } from './ui.service';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [AuthCardComponent],
  templateUrl: './auth-modal.component.html',
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthModalComponent {
  protected readonly ui = inject(UiService);

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
}
