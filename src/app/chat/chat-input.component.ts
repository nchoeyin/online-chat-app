import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatService } from './chat.service';
import { ModelId, UiService } from './ui.service';

@Component({
  selector: 'app-chat-input',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat-input.component.html',
  host: { class: 'block w-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatInputComponent {
  protected readonly chat = inject(ChatService);
  protected readonly ui = inject(UiService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly draft = signal('');
  protected readonly modelOpen = signal(false);
  protected readonly textareaRef = viewChild<ElementRef<HTMLTextAreaElement>>('textareaRef');

  @HostListener('document:click', ['$event'])
  protected onDocClick(e: MouseEvent): void {
    if (!this.modelOpen()) return;
    if (!this.host.nativeElement.contains(e.target as Node)) {
      this.modelOpen.set(false);
    }
  }

  protected onSubmit(): void {
    const value = this.draft().trim();
    if (!value) return;
    void this.chat.sendMessage(value);
    this.draft.set('');
    const el = this.textareaRef()?.nativeElement;
    if (el) el.style.height = 'auto';
  }

  protected onEnter(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.shiftKey) return;
    e.preventDefault();
    this.onSubmit();
  }

  protected autosize(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  protected toggleModel(e: MouseEvent): void {
    e.stopPropagation();
    this.modelOpen.update((v) => !v);
  }

  protected pickModel(id: ModelId, e: MouseEvent): void {
    e.stopPropagation();
    this.ui.setModel(id);
    this.modelOpen.set(false);
  }
}
