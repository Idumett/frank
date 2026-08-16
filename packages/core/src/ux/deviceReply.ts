import type { AssistantReply } from '@frank/contracts';

export function pickDeviceSpeak(reply: AssistantReply) {
  return reply.speak;
}
