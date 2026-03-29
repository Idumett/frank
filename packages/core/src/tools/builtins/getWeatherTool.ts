import type { Tool, ToolResult } from '../types.js';

export class GetWeatherTool implements Tool {
  name = 'get_weather';
  description = 'Get the current weather for a location';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const location =
      typeof input.location === 'string' && input.location.trim()
        ? input.location.trim()
        : 'your area';

    // Stub for now. Replace later with real weather API.
    return {
      ok: true,
      speak: `Weather in ${location}: mild and cloudy.`,
      data: {
        location,
        summary: 'mild and cloudy',
        temperatureC: 14,
      },
    };
  }
}
