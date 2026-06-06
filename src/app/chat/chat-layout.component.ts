import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ChatComponent } from './chat.component';
import { SidebarComponent } from './sidebar.component';

@Component({
  selector: 'app-chat-layout',
  standalone: true,
  imports: [SidebarComponent, ChatComponent],
  template: `
    <div class="flex h-screen w-screen overflow-hidden bg-cp-bg text-cp-text antialiased">
      <app-sidebar />
      <app-chat />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatLayoutComponent {}
