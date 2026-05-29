import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ChatService } from './chat.service';
import { UiService } from './ui.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  templateUrl: './sidebar.component.html',
  host: { class: 'flex h-full shrink-0' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  protected readonly chat = inject(ChatService);
  protected readonly ui = inject(UiService);
}
