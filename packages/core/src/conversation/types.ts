export type ConversationTurn = {
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
};

export interface ConversationStore {
  getRecent(sessionId: string, limit: number): Promise<ConversationTurn[]>;
  addTurn(turn: ConversationTurn): Promise<void>;
  clearSession?(sessionId: string): Promise<void>;
}
