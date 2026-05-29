import { Injectable, InjectionToken } from '@angular/core';
import { ChatMessage } from './chat.types';
import { ModelId } from './ui.service';

export interface ChatStreamRequest {
  messages: Pick<ChatMessage, 'role' | 'content'>[];
  model: ModelId;
  signal?: AbortSignal;
}

export interface ChatProvider {
  /** Streams an assistant reply token-by-token via `onChunk`. Resolves when complete. */
  stream(req: ChatStreamRequest, onChunk: (text: string) => void): Promise<void>;
}

export const CHAT_PROVIDER = new InjectionToken<ChatProvider>('CHAT_PROVIDER');

@Injectable({ providedIn: 'root' })
export class MockChatProvider implements ChatProvider {
  async stream(
    req: ChatStreamRequest,
    onChunk: (text: string) => void,
  ): Promise<void> {
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const reply =
      `Sure — quick take on "${last}":\n\n` +
      `This is a mocked **${req.model}** response. Swap \`MockChatProvider\` ` +
      `for \`OpenAIChatProvider\` (or your own \`ChatProvider\`) in \`app.config.ts\` ` +
      `to call a real API.\n\n` +
      `Try asking me to:\n` +
      `- Write some code (\`fizzbuzz in python\`)\n` +
      `- Make a list\n` +
      `- Format a table\n\n` +
      `\`\`\`ts\n` +
      `// Markdown is rendered with marked + DOMPurify\n` +
      `export const greet = (n: string) => \`Hello, \${n}!\`;\n` +
      `\`\`\``;

    const tokens = reply.split(/(\s+)/);
    for (const t of tokens) {
      if (req.signal?.aborted) return;
      onChunk(t);
      await new Promise((r) => setTimeout(r, 18));
    }
  }
}

/**
 * OpenAI-compatible streaming provider.
 *
 * Works with the official OpenAI API or any drop-in compatible endpoint
 * (Azure OpenAI with the /v1 surface, OpenRouter, local llama.cpp servers, etc.).
 *
 * Register it in app.config.ts:
 *
 *   { provide: CHAT_PROVIDER, useFactory: () => new OpenAIChatProvider({
 *       endpoint: 'https://api.openai.com/v1/chat/completions',
 *       apiKey: import.meta.env['NG_APP_OPENAI_KEY'],
 *       modelMap: { smart: 'gpt-4o', 'think-deeper': 'o3-mini', fast: 'gpt-4o-mini' },
 *   }) }
 *
 * For production, do NOT ship API keys to the browser — proxy through your backend
 * and point `endpoint` at your proxy.
 */
export class OpenAIChatProvider implements ChatProvider {
  constructor(
    private readonly config: {
      endpoint: string;
      apiKey?: string;
      modelMap: Record<ModelId, string>;
      systemPrompt?: string;
    },
  ) {}

  async stream(
    req: ChatStreamRequest,
    onChunk: (text: string) => void,
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;

    const body = {
      model: this.config.modelMap[req.model],
      stream: true,
      messages: [
        ...(this.config.systemPrompt
          ? [{ role: 'system', content: this.config.systemPrompt }]
          : []),
        ...req.messages,
      ],
    };

    const res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Chat API failed: ${res.status} ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta: string | undefined =
            json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content;
          if (delta) onChunk(delta);
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  }
}
