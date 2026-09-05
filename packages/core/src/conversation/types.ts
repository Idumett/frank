export type ConversationTurn = {
  userId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
};

export interface ConversationStore {
  getRecent(userId: string, sessionId: string, limit: number): Promise<ConversationTurn[]>;
  addTurn(turn: ConversationTurn): Promise<void>;
  clearSession?(userId: string, sessionId: string): Promise<void>;
}
