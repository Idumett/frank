export const FRANK_PROTOCOL_VERSION = 1;

// Shared trace type (mirrors Frank contracts, but lighter)
export type DeviceTrace = {
  sessionId: string;
  requestId: string;
};
