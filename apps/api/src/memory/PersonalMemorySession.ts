import crypto from 'node:crypto';
import type { MemoryItem, ProductActionProposalV1 } from '@frank/contracts';
import type { ProductDataPort } from '../productData/ProductDataPort.js';

export type PersonalMemoryResult = {
  speak: string;
  action: 'personal_memory_saved' | 'personal_memory_deleted' | 'personal_memory_not_found';
  data: { memoryKind: string };
};

export class PersonalMemorySession {
  constructor(private readonly store: ProductDataPort, private readonly ownerId: string) {}

  async handle(
    proposal: ProductActionProposalV1 | undefined,
    requestId: string,
    sessionId?: string,
  ): Promise<PersonalMemoryResult | null> {
    if (!proposal || !['save_personal_memory', 'delete_personal_memory'].includes(proposal.action))
      return null;

    const kind = proposal.memoryKind;
    const subject = clean(proposal.memorySubject, 80);
    const value = clean(proposal.memoryValue, 300);
    if (!kind || !subject) return null;

    const key = `${kind}:${canonical(subject)}`;
    const id = `personal-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
    if (proposal.action === 'delete_personal_memory') {
      const deleted = await this.store.delete(this.ownerId, [id]);
      return {
        speak: deleted ? `I've forgotten your ${subject}.` : `I don't have your ${subject} saved.`,
        action: deleted ? 'personal_memory_deleted' : 'personal_memory_not_found',
        data: { memoryKind: kind },
      };
    }
    if (!value || unsafeToStore(subject, value)) return null;

    const now = new Date().toISOString();
    const item: MemoryItem = {
      id,
      type: 'text',
      title: subject,
      content: value,
      tags: ['frank', 'personal', kind, `subject:${canonical(subject)}`],
      createdAt: now,
      trace: { requestId, sessionId },
    };

    await this.store.add(this.ownerId, item);
    return {
      speak: `Got it. I'll remember that your ${subject} is ${value}.`,
      action: 'personal_memory_saved',
      data: { memoryKind: kind },
    };
  }
}

function clean(value: string | undefined, limit: number) {
  return value?.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) ?? '';
}

function canonical(value: string) {
  return value
    .toLowerCase()
    .replace(/\bcolours?\b/g, 'color')
    .replace(/\bfavourites?\b/g, 'favorite')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function unsafeToStore(subject: string, value: string) {
  return /\b(password|passcode|pin|security answer|bank|card number|account number|sort code|medical|diagnosis|medication|prescription|home address|precise location|api key|secret token)\b/i.test(
    `${subject} ${value}`,
  );
}
