export type PerceptionPlan = {
  doOcr: boolean;
  doLabels: boolean;
  reason: string;
};

const OCR_HINTS = [
  'read',
  'say',
  'text',
  'written',
  'spells',
  'spell',
  'word',
  'words',
  'ingredients',
  'expiry',
  'expires',
  'expiration',
  'price',
  'serial',
  'receipt',
  'menu',
  'sign',
  'label',
  'barcode',
  'model number',
];

const LABEL_HINTS = [
  'what is',
  'what am i',
  'describe',
  'around me',
  'scene',
  'objects',
  'find',
  'locate',
  'where is',
  'which one',
  'identify',
];

const NO_VISION_HINTS = [
  'remind',
  'alarm',
  'timer',
  'call',
  'message',
  'news',
  'weather',
  'turn on',
  'turn off',
];

function includesAny(s: string, terms: string[]) {
  return terms.some((t) => s.includes(t));
}

//TODO: PerceptionPlan; not sure it would work, because sometimes we ask what something is expecting it to be read and not just labeled. So how do we differentiate?
export function decidePerceptionPlan(args: {
  intent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help';
  utterance?: string;
}): PerceptionPlan {
  const u = (args.utterance ?? '').toLowerCase().trim();

  // If intent already known from our UI or upstream router, trust it.
  if (args.intent === 'read_text')
    return { doOcr: true, doLabels: false, reason: 'intent=read_text' };
  if (args.intent === 'describe_scene')
    return { doOcr: false, doLabels: true, reason: 'intent=describe_scene' };
  if (args.intent === 'recall') return { doOcr: false, doLabels: false, reason: 'intent=recall' };
  if (args.intent === 'help') return { doOcr: false, doLabels: false, reason: 'intent=help' };

  // If utterance clearly doesn't need vision
  if (u && includesAny(u, NO_VISION_HINTS)) {
    return { doOcr: false, doLabels: false, reason: 'utterance=no_vision' };
  }

  const wantsOcr = u && includesAny(u, OCR_HINTS);
  const wantsLabels = u && includesAny(u, LABEL_HINTS);

  if (wantsOcr && wantsLabels) return { doOcr: true, doLabels: true, reason: 'utterance=mixed' };
  if (wantsOcr) return { doOcr: true, doLabels: false, reason: 'utterance=ocr' };
  if (wantsLabels) return { doOcr: false, doLabels: true, reason: 'utterance=labels' };

  // Default (Jarvis): do labels first, it's often faster/useful for general queries.
  return { doOcr: false, doLabels: true, reason: 'default=labels' };
}
