import { Injectable, computed, inject, signal } from '@angular/core';
import { CHAT_PROVIDER } from './chat-provider';
import { ChatMessage, Conversation } from './chat.types';
import { UiService } from './ui.service';

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly provider = inject(CHAT_PROVIDER);
  private readonly ui = inject(UiService);

  private readonly _conversations = signal<Conversation[]>([
    { id: uid(), title: 'ChatGPT Alternatives with Better…', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Naming a System Design Projects…', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Designing a Scalable Messaging …', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Websites for Sharing Text Across …', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Free Online Image Repositories', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Reply to HR with GitHub Submissi…', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Identifying Fonts in Figma', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Ubuntu Startup Issue with Sprinto', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Creating a Bootable Ubuntu USB', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'LinkedIn Certification Announce…', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Uses of Arab-DSR Medicine', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Netflix Standard Plan Access Limits', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Travel Directions from Hannur to …', messages: [], updatedAt: new Date() },
    { id: uid(), title: 'Names for Clay Pot Makers', messages: [], updatedAt: new Date() },
  ]);

  private readonly _activeId = signal<string | null>(null);
  private inflight: AbortController | null = null;

  readonly conversations = this._conversations.asReadonly();
  readonly activeId = this._activeId.asReadonly();
  readonly userName = signal('ngawang');
  readonly userEmail = signal('ngawangchoeying303@gmail.com');
  readonly plan = signal<'Free Plan' | 'Pro Plan'>('Free Plan');

  readonly activeConversation = computed<Conversation | null>(() => {
    const id = this._activeId();
    if (!id) return null;
    return this._conversations().find((c) => c.id === id) ?? null;
  });

  newConversation(): void {
    this.cancelInflight();
    this._activeId.set(null);
  }

  selectConversation(id: string): void {
    this.cancelInflight();
    this._activeId.set(id);
  }

  async sendMessage(rawContent: string): Promise<void> {
    const content = rawContent.trim();
    if (!content) return;

    let convId = this._activeId();
    if (!convId) {
      const conv: Conversation = {
        id: uid(),
        title: this.titleFromPrompt(content),
        messages: [],
        updatedAt: new Date(),
      };
      this._conversations.update((list) => [conv, ...list]);
      this._activeId.set(conv.id);
      convId = conv.id;
    }

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    const pendingId = uid();
    const pendingMsg: ChatMessage = {
      id: pendingId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      pending: true,
    };
    this.patchConversation(convId, (c) => ({
      ...c,
      messages: [...c.messages, userMsg, pendingMsg],
      updatedAt: new Date(),
    }));

    this.cancelInflight();
    this.inflight = new AbortController();
    const convIdLocal = convId;
    const history = [
      ...(this.activeConversation()?.messages ?? [])
        .filter((m) => !m.pending)
        .map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      await this.provider.stream(
        { messages: history, model: this.ui.model(), signal: this.inflight.signal },
        (chunk) => {
          this.patchConversation(convIdLocal, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === pendingId ? { ...m, content: m.content + chunk } : m,
            ),
          }));
        },
      );
    } catch (err) {
      const message =
        err instanceof Error && err.name !== 'AbortError'
          ? `_Error: ${err.message}_`
          : '';
      if (message) {
        this.patchConversation(convIdLocal, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === pendingId ? { ...m, content: m.content + '\n\n' + message } : m,
          ),
        }));
      }
    } finally {
      this.patchConversation(convIdLocal, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === pendingId ? { ...m, pending: false } : m,
        ),
      }));
      this.inflight = null;
    }
  }

  private cancelInflight(): void {
    this.inflight?.abort();
    this.inflight = null;
  }

  private patchConversation(id: string, fn: (c: Conversation) => Conversation): void {
    this._conversations.update((list) => list.map((c) => (c.id === id ? fn(c) : c)));
  }

  private titleFromPrompt(prompt: string): string {
    const clean = prompt.replace(/\s+/g, ' ').trim();
    return clean.length > 48 ? clean.slice(0, 48) + '…' : clean;
  }
}
