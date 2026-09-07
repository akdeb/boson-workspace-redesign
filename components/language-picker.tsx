"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Search } from "lucide-react";
import { LANGUAGES, TRANSCRIBABLE, flagUrl, type Language } from "@/lib/languages";

/**
 * Picking one of a hundred languages.
 *
 * A native `<select>` with 102 options is unsearchable and shows no flags, so this is a
 * popover: type to filter, flags from Twemoji so they look the same on every platform, and
 * the quality tier Boson publishes shown on the ones that are not top tier.
 */

function Flag({ language }: { language?: Language }) {
  const url = language && flagUrl(language.flag);
  if (!url) return <span className="lang-flag empty"><Globe aria-hidden="true" /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="lang-flag" src={url} alt="" width={20} height={20} loading="lazy" />;
}

export function LanguagePicker({ value, onChange, anyLabel, transcribableOnly = false, disabled }: {
  /** A language name, or "" for the "any" option. */
  value: string;
  onChange: (name: string) => void;
  /** What the empty choice is called — it differs between input and reply. */
  anyLabel: string;
  /** Only offer languages with an ISO-639-1 code, which the transcription hint requires. */
  transcribableOnly?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const options = transcribableOnly ? TRANSCRIBABLE : LANGUAGES;
  const selected = options.find(language => language.name === value);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(language => language.name.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const pick = (name: string) => { onChange(name); setOpen(false); setQuery(""); };

  return <div className="lang-picker" ref={rootRef}>
    <button
      className="field-button" disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open}
      onClick={() => setOpen(value => !value)}
    >
      {selected ? <Flag language={selected} /> : <span className="lang-flag empty"><Globe aria-hidden="true" /></span>}
      <b>{selected ? selected.name : anyLabel}</b>
      <ChevronDown aria-hidden="true" />
    </button>

    {open && <div className="lang-popover" role="listbox">
      <label className="lang-search">
        <Search aria-hidden="true" />
        <input
          autoFocus value={query} placeholder="Search languages"
          aria-label="Search languages"
          onChange={event => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="lang-list">
        <button
          role="option" aria-selected={!value}
          className={`lang-option ${!value ? "on" : ""}`}
          onClick={() => pick("")}
        >
          <span className="lang-flag empty"><Globe aria-hidden="true" /></span>
          <span className="lang-name">{anyLabel}</span>
          {!value && <Check aria-hidden="true" />}
        </button>
        {shown.map(language => <button
          key={language.name}
          role="option" aria-selected={value === language.name}
          className={`lang-option ${value === language.name ? "on" : ""}`}
          onClick={() => pick(language.name)}
        >
          <Flag language={language} />
          <span className="lang-name">{language.name}</span>
          {language.tier === "standard" && <em className="lang-tier" title="Standard quality (WER/CER 5–10)">standard</em>}
          {value === language.name && <Check aria-hidden="true" />}
        </button>)}
        {!shown.length && <p className="lang-empty">No language matches that.</p>}
      </div>
    </div>}
  </div>;
}
