import type { Tool, ToolRegistryLike } from './types.js';

export class ToolRegistry implements ToolRegistryLike {
  private tools = new Map<string, Tool>();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  list() {
    return Array.from(this.tools.values());
  }
}
