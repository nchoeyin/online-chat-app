export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  pending?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: Date;
}

export type SuggestionIcon =
  | 'image'
  | 'tag'
  | 'crystal'
  | 'quiz'
  | 'edit'
  | 'list'
  | 'doc'
  | 'speech';

export interface Suggestion {
  label: string;
  prompt: string;
  icon: SuggestionIcon;
}
