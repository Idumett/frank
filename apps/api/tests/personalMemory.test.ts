import { describe, expect, it } from 'vitest';
import type { MemoryItem } from '@frank/contracts';
import { PersonalMemorySession } from '../src/memory/PersonalMemorySession.js';

describe('personal memory', () => {
  it('turns a classified preference into an owned durable memory', async () => {
    const saved: Array<{ userId: string; item: MemoryItem }> = [];
    const store = {
      add: async (userId: string, item: MemoryItem) => saved.push({ userId, item }),
    } as any;
    const memory = new PersonalMemorySession(store, 'dan');

    const result = await memory.handle(
      {
        schemaVersion: '1', action: 'save_personal_memory', memoryKind: 'preference',
        memorySubject: 'favourite colour', memoryValue: 'red',
      },
      'request-memory-001',
      'session-memory-001',
    );

    expect(result).toMatchObject({
      speak: "Got it. I'll remember that your favourite colour is red.",
      action: 'personal_memory_saved',
    });
    expect(saved).toEqual([
      {
        userId: 'dan',
        item: expect.objectContaining({
          type: 'text', title: 'favourite colour', content: 'red',
          tags: expect.arrayContaining(['personal', 'preference', 'subject:favorite-color']),
          trace: { requestId: 'request-memory-001', sessionId: 'session-memory-001' },
        }),
      },
    ]);
  });

  it('refuses sensitive values even when a provider proposes storage', async () => {
    const saved: MemoryItem[] = [];
    const memory = new PersonalMemorySession(
      { add: async (_userId: string, item: MemoryItem) => saved.push(item) } as any,
      'dan',
    );
    const result = await memory.handle(
      {
        schemaVersion: '1', action: 'save_personal_memory', memoryKind: 'personal_fact',
        memorySubject: 'bank PIN', memoryValue: '1234',
      },
      'request-memory-002',
    );
    expect(result).toBeNull();
    expect(saved).toEqual([]);
  });

  it('deletes the same owned preference without relying on the original wording', async () => {
    let savedId = '';
    const deleted: Array<{ userId: string; ids: string[] }> = [];
    const memory = new PersonalMemorySession(
      {
        add: async (_userId: string, item: MemoryItem) => { savedId = item.id; },
        delete: async (userId: string, ids: string[]) => {
          deleted.push({ userId, ids });
          return 1;
        },
      } as any,
      'dan',
    );

    await memory.handle(
      {
        schemaVersion: '1', action: 'save_personal_memory', memoryKind: 'preference',
        memorySubject: 'favourite colour', memoryValue: 'red',
      },
      'request-memory-save',
    );

    const result = await memory.handle(
      {
        schemaVersion: '1', action: 'delete_personal_memory', memoryKind: 'preference',
        memorySubject: 'favorite color',
      },
      'request-memory-003',
    );

    expect(result).toMatchObject({
      speak: "I've forgotten your favorite color.",
      action: 'personal_memory_deleted',
    });
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.userId).toBe('dan');
    expect(deleted[0]?.ids).toEqual([savedId]);
  });
});
