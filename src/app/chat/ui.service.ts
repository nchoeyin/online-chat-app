import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

export type ModelId = 'smart' | 'think-deeper' | 'fast';

export interface ModelOption {
  id: ModelId;
  label: string;
  description: string;
}

const STORAGE_KEY = 'copilot.ui.v1';

interface PersistedState {
  theme: Theme;
  collapsed: boolean;
  model: ModelId;
}

function readPersisted(): Partial<PersistedState> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

@Injectable({ providedIn: 'root' })
export class UiService {
  private readonly initial = readPersisted();

  readonly theme = signal<Theme>(this.initial.theme ?? this.detectPrefersDark());
  readonly collapsed = signal<boolean>(this.initial.collapsed ?? false);
  readonly model = signal<ModelId>(this.initial.model ?? 'smart');
  readonly authModalOpen = signal(false);

  readonly models: ModelOption[] = [
    { id: 'smart', label: 'Smart', description: 'Balanced everyday model' },
    { id: 'think-deeper', label: 'Think Deeper', description: 'Slower, more reasoning' },
    { id: 'fast', label: 'Fast', description: 'Quickest replies' },
  ];

  constructor() {
    effect(() => {
      const root = typeof document !== 'undefined' ? document.documentElement : null;
      if (root) {
        root.classList.toggle('dark', this.theme() === 'dark');
        root.classList.toggle('light', this.theme() === 'light');
      }
    });

    effect(() => {
      if (typeof localStorage === 'undefined') return;
      const next: PersistedState = {
        theme: this.theme(),
        collapsed: this.collapsed(),
        model: this.model(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  toggleTheme(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  setModel(id: ModelId): void {
    this.model.set(id);
  }

  openAuth(): void {
    this.authModalOpen.set(true);
  }

  closeAuth(): void {
    this.authModalOpen.set(false);
  }

  selectedModel(): ModelOption {
    const id = this.model();
    return this.models.find((m) => m.id === id) ?? this.models[0];
  }

  private detectPrefersDark(): Theme {
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
