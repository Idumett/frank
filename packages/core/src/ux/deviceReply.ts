import type { AssistantReply } from '@frank/contracts';

export function pickDeviceSpeak(reply: AssistantReply) {
  if (reply.suggestedAction === 'recapture') {
    return 'Move closer and try again.'; //reply.recapturePrompt?.trim() ||
  }

  return reply.speak;
}
