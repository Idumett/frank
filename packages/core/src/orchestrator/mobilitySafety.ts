export type MobilitySafetyDecision = {
  code: 'road_crossing' | 'movement_safety' | 'turn_by_turn';
  speak: string;
};

export function mobilitySafetyDecision(text: string): MobilitySafetyDecision | null {
  if (/\b(safe|okay|ok|clear|can i|should i|when should i)\b.{0,35}\b(cross|crossing|road|street|traffic)\b|\b(cross|crossing)\b.{0,35}\b(safe|clear|now)\b/i.test(text))
    return {
      code: 'road_crossing',
      speak: "I can't determine whether a road is safe to cross. Please use your normal crossing method.",
    };
  if (/\b(is it safe|can i safely|is the way clear|can i step|should i step|can i walk forward|should i move forward)\b/i.test(text))
    return {
      code: 'movement_safety',
      speak: "I can't confirm that it is safe to move. Please stop and check with your usual mobility method.",
    };
  if (/\b(turn[- ]by[- ]turn|navigate me|guide me|give me directions|which turns|tell me when to turn|route me)\b/i.test(text))
    return {
      code: 'turn_by_turn',
      speak: "I can help you work out where you are, but I can't provide turn-by-turn navigation. Please use your usual navigation or mobility method.",
    };
  return null;
}
