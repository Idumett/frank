import type { ToolCall } from '@frank/contracts';
import type { ToolRegistryLike, ToolResult } from './types.js';

export async function executeToolCall(args: {
  call: ToolCall;
  registry: ToolRegistryLike;
}): Promise<ToolResult> {
  const tool = args.registry.get(args.call.tool);

  if (!tool) {
    return {
      ok: false,
      speak: `I do not have that tool yet.`,
    };
  }

  try {
    return await tool.execute(args.call.input);
  } catch (err: any) {
    return {
      ok: false,
      speak: `That action failed.`,
      data: { error: err?.message ?? 'Unknown tool error' },
    };
  }
}
