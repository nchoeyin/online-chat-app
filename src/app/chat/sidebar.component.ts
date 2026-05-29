import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
} from '@angular/core';
import { ChatService } from './chat.service';
import { UiService } from './ui.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  templateUrl: './sidebar.component.html',
  host: { class: 'relative flex h-full shrink-0' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  protected readonly chat = inject(ChatService);
  protected readonly ui = inject(UiService);
  private readonly host = inject(ElementRef<HTMLElement>);

  @HostListener('document:click', ['$event'])
  protected onDocClick(e: MouseEvent): void {
    if (!this.ui.userMenuOpen()) return;
    if (!this.host.nativeElement.contains(e.target as Node)) {
      this.ui.closeUserMenu();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.ui.userMenuOpen()) this.ui.closeUserMenu();
  }
}
