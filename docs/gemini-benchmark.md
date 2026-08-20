# Gemini prompt benchmark

Model: `gemini-3.5-flash`. Five V1 scenarios were run against the previous production prompt, the optimized prompt, and an immediate repeat of the optimized prompt. This is a small live sample for regression detection, not a statistically stable latency study.

| Prompt | Mean latency | Mean input | Mean output | Thought tokens | Cached tokens |
|---|---:|---:|---:|---:|---:|
| Previous | 2756 ms | 354 | 25 | 2068 | 0 |
| Optimized | 944 ms | 286 | 17 | 0 | 0 |
| Optimized repeat | 950 ms | 286 | 17 | 0 | 0 |

The optimized sample was 66% faster and used 19% fewer input tokens. Minimal thinking removed hidden thought-token work for these short assistance requests. The stable system instruction is 184 tokens. That is below Gemini's explicit context-cache minimum, so explicit caching would add storage and lifecycle work without a supported saving. Repeated requests reported zero cached tokens; implicit caching remains enabled automatically and the server records future hits from `cachedContentTokenCount`.

- **time_without_camera:** It is currently 3:04 AM.
- **scene_description:** There is a door and a chair in front of you.
- **read_text:** The label reads: "TAKE ONE TABLET DAILY".
- **follow_up:** I cannot tell how far away the door is from this view. If you can take a step closer or show me more of the surrounding floor, I might be able to help you estimate.
- **memory_recall:** You left your keys on the hall table, right beside the blue bowl.

Run the same comparison with `pnpm benchmark:gemini`. The normal V1 suite remains the deterministic correctness gate.
