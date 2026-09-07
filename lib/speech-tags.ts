/**
 * The Higgs TTS 3 inline control tags, as a list the enhancer can be handed.
 *
 * Kept beside the model call rather than imported from the composer, because the composer
 * is a client component and this is read on the server.
 * https://docs.boson.ai/models/higgs-tts/tags
 */

export const CONTROL_TAGS = {
  style: ["singing", "shouting", "whispering"],
  emotion: [
    "elation", "amusement", "enthusiasm", "determination", "pride", "contentment",
    "affection", "relief", "contemplation", "confusion", "surprise", "awe", "longing",
    "arousal", "anger", "fear", "disgust", "bitterness", "sadness", "shame", "helplessness",
  ],
  sfx: ["cough", "laughter", "crying", "screaming", "burping", "humming", "sigh", "sniff", "sneeze"],
  prosody: [
    "speed_very_slow", "speed_slow", "speed_fast", "speed_very_fast", "pitch_low",
    "pitch_high", "pause", "long_pause", "expressive_high", "expressive_low",
  ],
} as const;

export function tagCatalogue() {
  return Object.entries(CONTROL_TAGS)
    .map(([category, values]) => `${category}: ${values.map(value => `<|${category}:${value}|>`).join(" ")}`)
    .join("\n");
}
