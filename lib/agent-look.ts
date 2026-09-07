import {
  BellRing, Bot, Brain, Briefcase, CalendarDays, Flag, Globe, GraduationCap, HandHeart,
  Headset, HeartPulse, ListChecks, MessageSquareText, Mic, Newspaper, Phone, Plane, Puzzle,
  RadioTower, ShoppingBag, Stethoscope, Users, Utensils, Wrench,
} from "lucide-react";

/**
 * How an agent looks: one colour and one icon, chosen when it is created and editable
 * afterwards.
 *
 * The colour is not decoration. It is the agent's identity across the app — the tile in
 * every list, and the hue of the orb you talk to. A wall of agents that all look the same
 * is a wall of agents you cannot tell apart at a glance.
 */

export type AgentTone =
  | "blue" | "sky" | "teal" | "emerald" | "lime"
  | "amber" | "rose" | "pink" | "violet" | "indigo";

export type ToneSwatch = {
  label: string;
  /** Light background behind the icon. */
  tile: string;
  /** The icon itself, dark enough to read on `tile`. */
  ink: string;
  /**
   * The `hue-rotate` angle that carries the orb's blue to this tone.
   *
   * Not `target - base`: CSS `hue-rotate` is a fixed colour matrix, not a true rotation in
   * hue space, so the mapping is non-linear. Deriving the angle arithmetically sent rose to
   * orange. These are solved numerically against the spec's matrix from the orb's base blue
   * (#3b6fd6) and land within a degree of the named hue.
   */
  spin: number;
};

export const AGENT_TONES: Record<AgentTone, ToneSwatch> = {
  blue:    { label: "Blue",    tile: "#dbeafe", ink: "#1d4ed8", spin: 356 },
  sky:     { label: "Sky",     tile: "#e0f2fe", ink: "#0284c7", spin: 332 },
  teal:    { label: "Teal",    tile: "#ccfbf1", ink: "#0d9488", spin: 303 },
  emerald: { label: "Emerald", tile: "#d1fae5", ink: "#059669", spin: 289 },
  lime:    { label: "Lime",    tile: "#ecfccb", ink: "#5f9a0c", spin: 220 },
  amber:   { label: "Amber",   tile: "#fef3c7", ink: "#c2740c", spin: 178 },
  rose:    { label: "Rose",    tile: "#ffe4e6", ink: "#e11d48", spin: 119 },
  pink:    { label: "Pink",    tile: "#fce7f3", ink: "#db2777", spin: 96 },
  violet:  { label: "Violet",  tile: "#ede9fe", ink: "#7c3aed", spin: 39 },
  indigo:  { label: "Indigo",  tile: "#e0e7ff", ink: "#4f46e5", spin: 22 },
};

export const TONE_ORDER = Object.keys(AGENT_TONES) as AgentTone[];

/** The icons an agent may wear. Also the set the builder model is allowed to choose from. */
export const AGENT_ICONS = {
  "radio-tower": RadioTower, bot: Bot, brain: Brain, headset: Headset, phone: Phone,
  message: MessageSquareText, mic: Mic, users: Users, "hand-heart": HandHeart,
  "heart-pulse": HeartPulse, stethoscope: Stethoscope, "bell-ring": BellRing,
  "calendar-days": CalendarDays, "list-checks": ListChecks, newspaper: Newspaper,
  puzzle: Puzzle, flag: Flag, globe: Globe, "graduation-cap": GraduationCap,
  briefcase: Briefcase, "shopping-bag": ShoppingBag, utensils: Utensils, plane: Plane,
  wrench: Wrench,
} as const;

export type AgentIcon = keyof typeof AGENT_ICONS;

export const ICON_ORDER = Object.keys(AGENT_ICONS) as AgentIcon[];

/** The orb is a blue cloud; a tone is the spin that carries it to its own colour. */
export function orbFilter(tone: AgentTone) {
  return `hue-rotate(${AGENT_TONES[tone].spin}deg) saturate(1.7) brightness(.97)`;
}

/** Stable per-agent default, so an agent made before colours existed still has one. */
function fallback<T>(id: string, options: T[], offset = 0) {
  const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return options[(hash + offset) % options.length];
}

export type Looked = { tone: AgentTone; icon: AgentIcon; swatch: ToneSwatch };

export function agentLook(agent: { id: string; color?: string; icon?: string }): Looked {
  const tone = (agent.color && agent.color in AGENT_TONES ? agent.color : fallback(agent.id, TONE_ORDER)) as AgentTone;
  const icon = (agent.icon && agent.icon in AGENT_ICONS ? agent.icon : fallback(agent.id, ICON_ORDER, 3)) as AgentIcon;
  return { tone, icon, swatch: AGENT_TONES[tone] };
}
