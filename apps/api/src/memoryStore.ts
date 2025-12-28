import type { MemoryItem } from '@frank/contracts';

const memory: MemoryItem[] = [];

export function addMemory(item: MemoryItem) {
  memory.unshift(item);
}

export function searchMemory(query: string): MemoryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // Very simple search for skeleton (title/content/tags)
  return memory.filter((m) => {
    return (
      m.title.toLowerCase().includes(q) ||
      m.content.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
}

export function deleteMemory(ids: string[]): number {
  const before = memory.length;
  const idSet = new Set(ids);
  const kept = memory.filter((m) => !idSet.has(m.id));
  memory.length = 0;
  memory.push(...kept);
  return before - memory.length;
}

export function listRecent(limit: number): MemoryItem[] {
  return memory.slice(0, Math.max(0, limit));
}
