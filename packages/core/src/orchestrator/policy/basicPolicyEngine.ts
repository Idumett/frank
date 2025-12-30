import { PolicyDecisionSchema, type PolicyDecision } from '@frank/contracts';
import type { PolicyEngine } from '../types.js';

export class BasicPolicyEngine implements PolicyEngine {
  decide(args: Parameters<PolicyEngine['decide']>[0]): PolicyDecision {
    const reasons: string[] = [];

    // If image quality is poor, request recapture before spending money on LLM.
    if (args.quality.imageQuality === 'poor') {
      reasons.push(...args.quality.notes);
      const decision: PolicyDecision = {
        trace: args.request.trace,
        nextAction: 'request_recapture',
        confidence: 'low',
        reasons,
        recapturePrompt:
          'Image quality is too low. Please hold still and move closer, then try again.',
        estimatedCostUnits: 0,
        allowVisionCalls: true,
        allowLlmCall: false,
        shouldStore: false,
        requireUserConfirmToStore: true,
      };
      return PolicyDecisionSchema.parse(decision);
    }

    // If OCR intent but OCR text is empty, likely needs recapture.
    const ocrText = args.perception.ocr?.fullText?.trim() ?? '';
    if (args.request.intent === 'read_text' && ocrText.length < 3) {
      reasons.push('no_ocr_text_detected');
      const decision: PolicyDecision = {
        trace: args.request.trace,
        nextAction: 'request_recapture',
        confidence: 'low',
        reasons,
        recapturePrompt: 'I could not read any text. Please adjust the camera and try again.',
        estimatedCostUnits: 1,
        allowVisionCalls: true,
        allowLlmCall: false,
        shouldStore: false,
        requireUserConfirmToStore: true,
      };
      return PolicyDecisionSchema.parse(decision);
    }

    // Decide whether to store automatically.
    // For V1: only store for remember_this.
    const shouldStore = args.request.intent === 'remember_this';

    const decision: PolicyDecision = {
      trace: args.request.trace,
      nextAction: 'proceed',
      confidence: 'medium',
      reasons,
      estimatedCostUnits: 2,
      allowVisionCalls: true,
      allowLlmCall: true,
      shouldStore,
      requireUserConfirmToStore: true,
      ocrConfidence: args.perception.ocr?.confidence,
    };

    return PolicyDecisionSchema.parse(decision);
  }
}
