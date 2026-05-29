import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { CHAT_PROVIDER, MockChatProvider } from './chat/chat-provider';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    { provide: CHAT_PROVIDER, useClass: MockChatProvider },

    /*
     * To use the real OpenAI / Azure OpenAI / OpenAI-compatible API, replace the
     * line above with the following (and keep the API key on a backend proxy in
     * production — do not ship it to the browser):
     *
     * {
     *   provide: CHAT_PROVIDER,
     *   useFactory: () => new OpenAIChatProvider({
     *     endpoint: 'https://api.openai.com/v1/chat/completions',
     *     apiKey: 'sk-...',                  // BACKEND ONLY — proxy in production
     *     modelMap: {
     *       smart:          'gpt-4o',
     *       'think-deeper': 'o3-mini',
     *       fast:           'gpt-4o-mini',
     *     },
     *     systemPrompt: 'You are Copilot, a helpful AI assistant.',
     *   }),
     * },
     */
  ],
};
