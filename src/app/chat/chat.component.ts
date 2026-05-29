import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { ChatInputComponent } from './chat-input.component';
import { ChatService } from './chat.service';
import { Suggestion } from './chat.types';
import { MarkdownPipe } from './markdown.pipe';
import { UiService } from './ui.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [ChatInputComponent, MarkdownPipe],
  templateUrl: './chat.component.html',
  host: { class: 'flex h-full min-w-0 flex-1' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent implements AfterViewChecked {
  protected readonly chat = inject(ChatService);
  protected readonly ui = inject(UiService);

  protected readonly scrollRef = viewChild<ElementRef<HTMLDivElement>>('scrollRef');

  protected readonly suggestions: Suggestion[] = [
    { icon: 'image',   label: 'Create an image',     prompt: 'Create an image of …' },
    { icon: 'tag',     label: 'Find the best deal',  prompt: 'Find the best deal on …' },
    { icon: 'crystal', label: 'Predict the future',  prompt: 'Predict what will happen with …' },
    { icon: 'quiz',    label: 'Take a quiz',         prompt: 'Give me a fun quiz about …' },
    { icon: 'edit',    label: 'Improve writing',     prompt: 'Improve the writing of this passage: …' },
    { icon: 'list',    label: 'Organize thoughts',   prompt: 'Help me organize my thoughts about …' },
    { icon: 'doc',     label: 'Draft a text',        prompt: 'Draft a text message that …' },
    { icon: 'speech',  label: 'Write a speech',      prompt: 'Write a short speech about …' },
  ];

  ngAfterViewChecked(): void {
    const el = this.scrollRef()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  protected useSuggestion(prompt: string): void {
    void this.chat.sendMessage(prompt);
  }
}
