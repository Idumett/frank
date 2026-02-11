import { PolicyDecisionSchema, type PolicyDecision } from '@frank/contracts';
import type { PolicyEngine } from '../types.js';

export class BasicPolicyEngine implements PolicyEngine {
  decide(args: Parameters<PolicyEngine['decide']>[0]): PolicyDecision {
    const reasons: string[] = [];

    const utterance = args.request.utterance?.trim() ?? '';
    const query = (args.request as any).query?.trim?.() ?? ''; // if we have query in UserRequest
    const hasSpecificQuestion = utterance.length > 0 || query.length > 0;

    const ocrText = args.perception.ocr?.fullText?.trim() ?? '';
    const hasLabels = (args.perception.labels?.length ?? 0) > 0;
    const hasAnyVisionSignal = ocrText.length > 0 || hasLabels;

    const isPoor = args.quality.imageQuality === 'poor';

    /**
     * JARVIS MODE:
     * Even if image quality is poor, proceed with LLM if the user asked something specific.
     * But remain honest: low confidence + include a recapture prompt (for follow-up).
     */
    if (isPoor) {
      reasons.push(...args.quality.notes);

      if (hasSpecificQuestion) {
        reasons.push('poor_image_quality_but_user_asked_specific_question');

        const decision: PolicyDecision = {
          trace: args.request.trace,
          nextAction: 'proceed',
          confidence: 'low',
          reasons,

          // Keep this as a hint—our LLM reply can include it too, but having it here helps the orchestrator.
          recapturePrompt: 'If you can, hold still and move closer for a clearer look.',

          estimatedCostUnits: 2,
          allowVisionCalls: true,
          allowLlmCall: true,

          // Don't store when quality is poor by default.
          shouldStore: false,
          requireUserConfirmToStore: true,
        };

        return PolicyDecisionSchema.parse(decision);
      }

      // If image is poor and user didn't ask anything specific, and we got no useful signal, recapture.
      if (!hasAnyVisionSignal) {
        reasons.push('poor_image_quality_no_question_no_signal');

        const decision: PolicyDecision = {
          trace: args.request.trace,
          nextAction: 'request_recapture',
          confidence: 'low',
          reasons,
          recapturePrompt: "I can't make it out. Please hold still, move closer, and try again.",
          estimatedCostUnits: 0,
          allowVisionCalls: true,
          allowLlmCall: false,
          shouldStore: false,
          requireUserConfirmToStore: true,
        };

        return PolicyDecisionSchema.parse(decision);
      }

      // If image is poor but we have SOME signal (labels or partial OCR) and no question,
      // proceed with LLM to produce a short cautious description.
      reasons.push('poor_image_quality_some_signal');

      const decision: PolicyDecision = {
        trace: args.request.trace,
        nextAction: 'proceed',
        confidence: 'low',
        reasons,
        recapturePrompt: 'If you can, move closer for a better look.',
        estimatedCostUnits: 2,
        allowVisionCalls: true,
        allowLlmCall: true,
        shouldStore: false,
        requireUserConfirmToStore: true,
        ocrConfidence: args.perception.ocr?.confidence,
      };

      return PolicyDecisionSchema.parse(decision);
    }

    /**
     * OCR intent but no text detected.
     * In Jarvis mode, if the user asked a specific question, try LLM anyway (it can say "not sure").
     * Otherwise, recapture.
     */
    if (args.request.intent === 'read_text' && ocrText.length < 3) {
      reasons.push('no_ocr_text_detected');

      if (!hasSpecificQuestion) {
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

      // User asked something specific—let the LLM respond cautiously.
      reasons.push('user_asked_specific_question_without_ocr_text');

      const decision: PolicyDecision = {
        trace: args.request.trace,
        nextAction: 'proceed',
        confidence: 'low',
        reasons,
        recapturePrompt: 'I couldn’t read the text clearly. Please try closer to confirm.',
        estimatedCostUnits: 2,
        allowVisionCalls: true,
        allowLlmCall: true,
        shouldStore: false,
        requireUserConfirmToStore: true,
      };
      return PolicyDecisionSchema.parse(decision);
    }

    // Decide whether to store automatically.
    // For V1: only store for remember_this (and only when not poor quality).
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
