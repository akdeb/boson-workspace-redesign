"use client";

import { useRef, useState } from "react";
import { AudioLines, BookOpen, Gift, Hand, Loader2, Presentation, WandSparkles } from "lucide-react";

/**
 * Higgs TTS 3 inline control tags. Syntax is `<|category:value|>`; delivery tags lead the
 * turn, pause tags sit exactly where the break should fall.
 * https://docs.boson.ai/models/higgs-tts/tags
 */
const CONTROL_TAG_GROUPS: Array<{ label: string; category: string; tone: string; values: string[] }> = [
  { label: "Style", category: "style", tone: "style", values: ["singing", "shouting", "whispering"] },
  { label: "Emotions", category: "emotion", tone: "emotion", values: [
    "elation", "amusement", "enthusiasm", "determination", "pride", "contentment", "affection",
    "relief", "contemplation", "confusion", "surprise", "awe", "longing", "arousal", "anger",
    "fear", "disgust", "bitterness", "sadness", "shame", "helplessness",
  ] },
  { label: "Sound effects", category: "sfx", tone: "sfx", values: [
    "cough", "laughter", "crying", "screaming", "burping", "humming", "sigh", "sniff", "sneeze",
  ] },
  { label: "Prosody", category: "prosody", tone: "prosody", values: [
    "speed_very_slow", "speed_slow", "speed_fast", "speed_very_fast", "pitch_low", "pitch_high",
    "pause", "long_pause", "expressive_high", "expressive_low",
  ] },
];

type ControlTag = { label: string; tone: string; token: string };

const CONTROL_TAGS: ControlTag[] = CONTROL_TAG_GROUPS.flatMap(group =>
  group.values.map(value => ({
    label: value.replace(/_/g, " "),
    tone: group.tone,
    token: `<|${group.category}:${value}|>`,
  })),
);

function matchingTags(query: string) {
  const needle = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!needle) return CONTROL_TAGS;
  return CONTROL_TAGS.filter(tag => tag.token.toLowerCase().includes(needle));
}

export function PresetRow({ labels, onPick }: { labels: string[]; onPick: (preset: string) => void }) {
  const icons = [<Hand key="h" />, <Presentation key="p" />, <Gift key="g" />, <BookOpen key="b" />];
  return <div className="presets">{labels.map((preset, index) =>
    <button key={preset} onClick={() => onPick(preset)}>{icons[index]}{preset}</button>)}</div>;
}

/**
 * The shared script box for Text-to-speech and Avatar Speech. Typing `/` opens the control
 * tag menu; picking one replaces the `/query` in place.
 */
export function Composer({ value, onChange, placeholder, children }: {
  value: string; onChange: (next: string) => void; placeholder?: string; children: React.ReactNode;
}) {
  const [menu, setMenu] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const matches = menu ? matchingTags(menu.query) : [];

  const syncMenu = (next: string, caret: number) => {
    // Only a `/` that starts a word opens the menu, so dates and URLs are left alone.
    const match = /(?:^|\s)\/([\p{L}_ ]*)$/u.exec(next.slice(0, caret));
    setMenu(match ? { query: match[1], start: caret - match[1].length - 1 } : null);
    setActive(0);
  };

  const insert = (tag: ControlTag) => {
    if (!menu) return;
    const before = value.slice(0, menu.start);
    const after = value.slice(menu.start + 1 + menu.query.length);
    onChange(`${before}${tag.token}${after}`);
    setMenu(null);
    const caret = before.length + tag.token.length;
    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu || !matches.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => (index + 1) % matches.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index - 1 + matches.length) % matches.length); }
    else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insert(matches[active]); }
    else if (event.key === "Escape") { event.preventDefault(); setMenu(null); }
  };

  return <div className="composer">
    {/* A textarea cannot draw a pill, so the script is painted a second time underneath by
        `TaggedText` and the real field is left with transparent text and a visible caret.
        The two only stay in register if the tags occupy exactly the width of the characters
        they replace — see `.tag-pill`, whose padding is cancelled by a negative margin. */}
    <div className="composer-input">
      <div className="composer-mirror" ref={mirrorRef} aria-hidden="true">
        <TaggedText value={value} />
      </div>
      <textarea
        ref={areaRef}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onScroll={event => {
          const mirror = mirrorRef.current;
          if (mirror) mirror.scrollTop = event.currentTarget.scrollTop;
        }}
        onChange={event => { onChange(event.currentTarget.value); syncMenu(event.currentTarget.value, event.currentTarget.selectionStart ?? 0); }}
        onKeyDown={onKeyDown}
        onBlur={() => window.setTimeout(() => setMenu(null), 120)}
      />
    </div>
    {menu && matches.length > 0 && <TagMenu tags={matches} active={active} onHover={setActive} onPick={insert} />}
    {children}
  </div>;
}

/** A `<|category:value|>` token, or the plain run of text between two of them. */
const TAG_PATTERN = /<\|([a-z]+):([a-z_]+)\|>/gi;

function TaggedText({ value }: { value: string }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(TAG_PATTERN)) {
    const at = match.index ?? 0;
    if (at > cursor) parts.push(value.slice(cursor, at));
    const category = match[1].toLowerCase();
    const known = CONTROL_TAG_GROUPS.some(group => group.category === category);
    parts.push(
      <span key={`${at}-${match[0]}`} className={`tag-pill ${known ? category : "unknown"}`}>{match[0]}</span>,
    );
    cursor = at + match[0].length;
  }
  parts.push(value.slice(cursor));
  // The trailing newline is swallowed by the browser unless something follows it, which
  // would drop the mirror a line behind the caret on the last empty line.
  return <>{parts}{"\n"}</>;
}

function TagMenu({ tags, active, onHover, onPick }: {
  tags: ControlTag[]; active: number; onHover: (index: number) => void; onPick: (tag: ControlTag) => void;
}) {
  let heading = "";
  return <div className="tag-menu" role="listbox" aria-label="Control tags">
    {tags.map((tag, index) => {
      const group = CONTROL_TAG_GROUPS.find(candidate => candidate.tone === tag.tone)!;
      const showHeading = group.label !== heading;
      heading = group.label;
      return <div key={tag.token}>
        {showHeading && <h4>{group.label}</h4>}
        <button
          role="option"
          aria-selected={index === active}
          className={`tag-option ${tag.tone} ${index === active ? "active" : ""}`}
          onMouseEnter={() => onHover(index)}
          onMouseDown={event => { event.preventDefault(); onPick(tag); }}
        >{tag.label}</button>
      </div>;
    })}
  </div>;
}

export function ComposerFooter({ enabled, busy = false, label = "Generate", onGenerate, note, onEnhance }: {
  enabled: boolean; busy?: boolean; label?: string; onGenerate?: () => void; note?: string;
  /** Marks the script up with control tags. Omitted where there is nothing to enhance. */
  onEnhance?: () => Promise<void> | void;
}) {
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enhance = async () => {
    if (!onEnhance) return;
    setEnhancing(true);
    setError(null);
    try { await onEnhance(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not enhance the script."); }
    finally { setEnhancing(false); }
  };

  return <div className="composer-footer">
    <span>{error ?? <>Type <kbd>/</kbd> to add control tags</>}</span>
    <div className="composer-actions">
      <div className="composer-buttons">
      {onEnhance && <button
        className="enhance"
        disabled={!enabled || busy || enhancing}
        title="Mark the script up with emotion, pacing and sound tags"
        onClick={() => void enhance()}
      >
        {enhancing ? <Loader2 className="spin" aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}
        {enhancing ? "Enhancing…" : "Enhance"}
      </button>}
      <button disabled={!enabled || busy} onClick={onGenerate}><AudioLines aria-hidden="true" />{busy ? "Generating…" : label}</button>
      </div>
      {note && <small>{note}</small>}
    </div>
  </div>;
}

/** Ask the enhancer to mark a script up with control tags. Throws with a usable message. */
export async function enhanceScript(text: string) {
  const response = await fetch("/api/speech/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await response.json().catch(() => null) as { text?: string; error?: string } | null;
  if (!response.ok || !body?.text) throw new Error(body?.error ?? `The enhancer failed (${response.status}).`);
  return body.text;
}
