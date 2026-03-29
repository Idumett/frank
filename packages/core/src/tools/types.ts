export type ToolResult = {
  ok: boolean;
  speak: string;
  data?: unknown;
};

export interface Tool {
  name: string;
  description: string;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolRegistryLike {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
}
