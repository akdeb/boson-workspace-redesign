import type { BosonActivity } from "@/lib/boson-realtime";

/**
 * How loud the orb should look.
 *
 * It follows whoever is talking: your microphone while it listens, the agent's own output
 * while it speaks. Feeding it a constant during the agent's turn — which is what it used
 * to get — left it sitting perfectly still through the half of the call that has the most
 * to show. Both levels are RMS, so they are scaled into the 0–1 the orb wants and floored
 * so it never collapses to nothing mid-sentence.
 */
export function orbVolume(activity: BosonActivity, micLevel: number, outputLevel: number) {
  if (activity === "speaking") return Math.max(.25, Math.min(1, outputLevel * 5.5));
  if (activity === "listening") return Math.max(.12, Math.min(1, micLevel * 7));
  return .3;
}

/**
 * The state to hand the orb.
 *
 * The cloud theme only draws a cloud for idle, listening and speaking — `connecting` and
 * `thinking` fall back to a small coloured dot (that gold pip is the theme's own
 * `connecting` colour, #f0c040). Since those two are transient and the status line already
 * names them in words, the orb keeps its listening cloud through them rather than
 * collapsing to a speck mid-call.
 */
export function orbState(activity: BosonActivity) {
  if (activity === "speaking") return "speaking" as const;
  if (activity === "error") return "error" as const;
  return "listening" as const;
}
