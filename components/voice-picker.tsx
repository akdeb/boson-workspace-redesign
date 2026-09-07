"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Loader2, MicVocal, Play, Plus, Search, Square, Trash2, X } from "lucide-react";
import { playPreview, stopPreview } from "@/lib/audio";
import type { VoiceRecord } from "@/lib/store/types";

/** A short line each voice speaks when previewed, so presets and clones are comparable. */
const PREVIEW_LINE = "Hi there — this is what I sound like. Tell me what you'd like to build today.";

export function Wave({ active = false }: { active?: boolean }) {
  return <span className={`wave ${active ? "wave-active" : ""}`}>{[15, 27, 37, 30, 24, 34, 19].map((height, index) => <i key={index} style={{ height }} />)}</span>;
}

/** Previews are synthesized on demand and cached for the life of the page. */
function usePreview() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const cache = useRef(new Map<string, string>());

  useEffect(() => () => {
    stopPreview();
    for (const url of cache.current.values()) URL.revokeObjectURL(url);
  }, []);

  const toggle = async (voice: VoiceRecord) => {
    if (playing === voice.id) { stopPreview(); setPlaying(null); return; }
    const cached = cache.current.get(voice.id);
    if (cached) {
      setPlaying(voice.id);
      playPreview(cached).onended = () => setPlaying(null);
      return;
    }
    setLoading(voice.id);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: PREVIEW_LINE, voice: voice.id, format: "mp3" }),
      });
      if (!response.ok) throw new Error("preview failed");
      const url = URL.createObjectURL(await response.blob());
      cache.current.set(voice.id, url);
      setPlaying(voice.id);
      playPreview(url).onended = () => setPlaying(null);
    } catch {
      setPlaying(null);
    } finally {
      setLoading(null);
    }
  };

  return { playing, loading, toggle };
}

export function VoiceCard({ voice, active, onClick, preview, onDelete }: {
  voice: VoiceRecord; active: boolean; onClick: () => void; preview: ReturnType<typeof usePreview>;
  /** Cloned voices only — a preset is part of the model, not something you own. */
  onDelete?: () => void;
}) {
  const isPlaying = preview.playing === voice.id;
  const isLoading = preview.loading === voice.id;
  return <div className={`voice-card ${active ? "selected" : ""}`} onClick={onClick} role="button" tabIndex={0}>
    <Wave active={active || isPlaying} />
    <div className="voice-copy">
      <div><b>{voice.label}</b><span className={voice.kind === "cloned" ? "cloned-tag" : ""}>{voice.tag}</span></div>
      <p>{voice.description}</p>
    </div>
    <button
      className="play"
      aria-label={`${isPlaying ? "Stop" : "Play"} ${voice.label}`}
      onClick={event => { event.stopPropagation(); void preview.toggle(voice); }}
    >
      {isLoading ? <Loader2 className="spin" /> : isPlaying ? <Square /> : <Play />}
    </button>
    {onDelete && voice.kind === "cloned" && <button
      className="voice-delete" aria-label={`Delete ${voice.label}`}
      onClick={event => { event.stopPropagation(); onDelete(); }}
    ><Trash2 /></button>}
  </div>;
}

/** The four-card list plus "browse all", shared by every studio's settings panel. */
export function VoiceSection({ voices, selected, onSelect, onClone, onDelete, heading = "Voice", help = "Pick a voice. Tap play to preview" }: {
  voices: VoiceRecord[]; selected: string; onSelect: (id: string) => void; onClone?: () => void;
  onDelete?: (id: string) => void; heading?: string; help?: string;
}) {
  const [browsing, setBrowsing] = useState(false);
  const preview = usePreview();

  // Always show the selected voice, even when it sorts below the fold of the short list.
  const shortlist = voices.slice(0, 4);
  const chosen = voices.find(voice => voice.id === selected);
  const visible = chosen && !shortlist.includes(chosen) ? [chosen, ...shortlist.slice(0, 3)] : shortlist;

  return <>
    <div className="panel-section-head">
      <h2>{heading}</h2>
      {onClone && <button className="link-button" onClick={onClone}><Plus aria-hidden="true" />Clone a voice</button>}
    </div>
    <p className="help">{help}</p>
    <div className="voice-list">
      {visible.map(voice => <VoiceCard key={voice.id} voice={voice} active={voice.id === selected} onClick={() => onSelect(voice.id)} preview={preview} />)}
    </div>
    <button className="browse" onClick={() => setBrowsing(true)}>Browse all voices <ArrowRight /></button>
    {browsing && <VoiceModal
      voices={voices}
      selected={selected}
      onClone={onClone}
      onDelete={onDelete}
      onClose={() => setBrowsing(false)}
      onConfirm={id => { onSelect(id); setBrowsing(false); }}
    />}
  </>;
}

export function VoiceModal({ voices, selected, onClose, onConfirm, onClone, onDelete }: {
  voices: VoiceRecord[]; selected: string; onClose: () => void; onConfirm: (id: string) => void;
  onClone?: () => void; onDelete?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(selected);
  const preview = usePreview();
  const shown = voices.filter(voice => `${voice.label} ${voice.tag} ${voice.description}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const cloned = shown.filter(voice => voice.kind === "cloned");
  const presets = shown.filter(voice => voice.kind === "preset");

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="picker-modal voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-modal-title">
      <div className="modal-head">
        <h2 id="voice-modal-title">Browse voices</h2>
        {onClone && <button className="modal-head-action" onClick={() => { onClose(); onClone(); }}>
          <Plus aria-hidden="true" />Clone a voice
        </button>}
        <button aria-label="Close" onClick={onClose}><X /></button>
      </div>
      <label className="modal-search">
        <Search />
        <input autoFocus value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search by name, language, or tone" aria-label="Search voices" />
      </label>
      <div className="modal-voices-scroll">
        {cloned.length > 0 && <>
          <h3 className="voice-group">Your cloned voices</h3>
          <div className="modal-voices">
            {cloned.map(voice => <VoiceCard
              key={voice.id} voice={voice} active={draft === voice.id} preview={preview}
              onClick={() => setDraft(voice.id)}
              onDelete={onDelete && (() => { onDelete(voice.id); if (draft === voice.id) setDraft(selected); })}
            />)}
          </div>
        </>}
        {presets.length > 0 && <>
          <h3 className="voice-group">Preset voices</h3>
          <div className="modal-voices">
            {presets.map(voice => <VoiceCard key={voice.id} voice={voice} active={draft === voice.id} onClick={() => setDraft(voice.id)} preview={preview} />)}
          </div>
        </>}
        {!shown.length && <div className="no-results">No voices match your search.</div>}
      </div>
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => onConfirm(draft)}>Use this voice</button>
      </div>
    </section>
  </div>;
}

/**
 * The voice as one line: what is selected, and a way to change it.
 *
 * A settings page has no room for a scrolling list of cards per field — the picker lives
 * in the modal, and what stays on the page is the answer. Same shape as every other
 * collapsed control in `AgentSettings`.
 */
export function VoiceField({ voices, selected, onSelect, onClone, onDelete, disabled }: {
  voices: VoiceRecord[]; selected: string; onSelect: (id: string) => void; onClone?: () => void;
  onDelete?: (id: string) => void; disabled?: boolean;
}) {
  const [browsing, setBrowsing] = useState(false);
  const voice = voices.find(candidate => candidate.id === selected);
  return <>
    <button className="field-button" disabled={disabled} onClick={() => setBrowsing(true)}>
      <Wave />
      <b>{voice?.label ?? selected}</b>
      {voice?.kind === "cloned" && <em className="cloned-tag">Cloned</em>}
      <ChevronDown aria-hidden="true" />
    </button>
    {browsing && <VoiceModal
      voices={voices}
      selected={selected}
      onClone={onClone}
      onDelete={onDelete}
      onClose={() => setBrowsing(false)}
      onConfirm={id => { onSelect(id); setBrowsing(false); }}
    />}
  </>;
}
