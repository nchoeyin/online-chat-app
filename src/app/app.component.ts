import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AuthModalComponent } from './chat/auth-modal.component';
import { ChatComponent } from './chat/chat.component';
import { SidebarComponent } from './chat/sidebar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SidebarComponent, ChatComponent, AuthModalComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
