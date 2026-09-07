"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { faceSrc } from "@/lib/store/use-studio";
import { ACCEPTED_IMAGES, faceAdvice, faceProblem, prepareFace, type PreparedFace } from "@/lib/face-upload";
import type { FaceRecord } from "@/lib/store/types";

/**
 * Picking and uploading the face the renderer animates.
 *
 * Uploads are the exact counterpart of a cloned voice: your own reference, stored beside
 * the presets, usable anywhere a preset is. What differs is where the bytes live — a
 * preset is a file on the server addressed by name, an upload travels with the request.
 * See `facePayload` in lib/store/use-studio.ts.
 */

function FaceTile({ face, selected, onClick, sizes }: {
  face: FaceRecord; selected: boolean; onClick: () => void; sizes: string;
}) {
  return <button className={selected ? "selected" : ""} onClick={onClick} title={face.label}>
    <Image src={faceSrc(face)} alt={face.label} fill sizes={sizes} unoptimized={face.kind === "uploaded"} />
    <span>{face.label}</span>
    {selected && <i><Check /></i>}
  </button>;
}

/** The three-up grid plus "browse all" and "upload", for the Avatar Studio panel. */
export function FaceSection({ faces, selected, onSelect, onUpload, onDelete }: {
  faces: FaceRecord[]; selected: string; onSelect: (id: string) => void; onUpload: () => void;
  onDelete?: (id: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);

  // Always show the chosen face, even when it sorts below the fold of the short list. The
  // add tile takes the third slot, so only two faces are on show beside it.
  const shortlist = faces.slice(0, 3);
  const chosen = faces.find(face => face.id === selected);
  const visible = chosen && !shortlist.includes(chosen) ? [chosen, ...shortlist.slice(0, 2)] : shortlist;

  return <>
    <div className="panel-section-head">
      <h2>Face</h2>
      <button className="link-button" onClick={onUpload}><Plus aria-hidden="true" />New face</button>
    </div>
    <p className="help">Pick the face your audience sees</p>
    <div className="faces">
      {visible.map(face => <FaceTile
        key={face.id} face={face} selected={face.id === selected} sizes="110px"
        onClick={() => onSelect(face.id)}
      />)}
    </div>
    <button className="browse" onClick={() => setBrowsing(true)}>Browse all faces <ArrowRight /></button>
    {browsing && <FaceModal
      faces={faces} selected={selected} onUpload={onUpload} onDelete={onDelete}
      onClose={() => setBrowsing(false)}
      onConfirm={id => { onSelect(id); setBrowsing(false); }}
    />}
  </>;
}

export function FaceModal({ faces, selected, onClose, onConfirm, onUpload, onDelete }: {
  faces: FaceRecord[]; selected: string; onClose: () => void; onConfirm: (id: string) => void;
  onUpload?: () => void; onDelete?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(selected);
  const shown = faces.filter(face => face.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const mine = shown.filter(face => face.kind === "uploaded");
  const presets = shown.filter(face => face.kind === "preset");

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="picker-modal face-modal" role="dialog" aria-modal="true" aria-labelledby="face-modal-title">
      <div className="modal-head">
        <h2 id="face-modal-title">Browse faces</h2>
        {onUpload && <button className="modal-head-action" onClick={() => { onClose(); onUpload(); }}>
          <Plus aria-hidden="true" />New face
        </button>}
        <button aria-label="Close" onClick={onClose}><X /></button>
      </div>
      <label className="modal-search">
        <Search />
        <input autoFocus value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search by name" aria-label="Search faces" />
      </label>
      <div className="modal-faces-scroll">
        {mine.length > 0 && <>
          <h3 className="voice-group">Your faces</h3>
          <div className="face-modal-grid">
            {mine.map(face => <div className="own-face" key={face.id}>
              <FaceTile face={face} selected={draft === face.id} sizes="260px" onClick={() => setDraft(face.id)} />
              {onDelete && <button
                className="face-delete" aria-label={`Delete ${face.label}`}
                onClick={() => { onDelete(face.id); if (draft === face.id) setDraft(selected); }}
              ><Trash2 /></button>}
            </div>)}
          </div>
        </>}
        {presets.length > 0 && <>
          {mine.length > 0 && <h3 className="voice-group">Preset faces</h3>}
          <div className="face-modal-grid">
            {presets.map(face => <FaceTile key={face.id} face={face} selected={draft === face.id} sizes="260px" onClick={() => setDraft(face.id)} />)}
          </div>
        </>}
        {!shown.length && <div className="no-results">No faces match your search.</div>}
      </div>
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => onConfirm(draft)}>Use this face</button>
      </div>
    </section>
  </div>;
}

/**
 * Upload a reference photo. The counterpart of `CloneVoiceModal`: pick a source, name it,
 * and it joins the library. The image is cropped and re-encoded before it leaves this
 * dialog — see lib/face-upload.ts for why.
 */
export function UploadFaceModal({ onClose, onCreated, newId }: {
  onClose: () => void; onCreated: (face: FaceRecord) => void; newId: (prefix: string) => string;
}) {
  const [label, setLabel] = useState("");
  const [prepared, setPrepared] = useState<PreparedFace | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, busy]);

  const accept = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      setPrepared(await prepareFace(file));
      // A file name makes a better default than an empty box, minus its extension.
      if (!label.trim()) setLabel(file.name.replace(/\.[^.]+$/, "").slice(0, 40));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That image could not be used.");
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    if (!prepared) return;
    onCreated({
      id: newId("face"), label: label.trim(), kind: "uploaded",
      dataUri: prepared.dataUri, createdAt: new Date().toISOString(),
    });
  };

  const blocker = faceProblem(prepared);
  const advice = faceAdvice(prepared);
  const ready = !!prepared && !!label.trim() && !busy;

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="picker-modal upload-face-modal" role="dialog" aria-modal="true" aria-labelledby="upload-face-title">
      <div className="modal-head">
        <h2 id="upload-face-title">Upload a face</h2>
        <button aria-label="Close" onClick={onClose} disabled={busy}><X /></button>
      </div>
      <p className="clone-lede">
        Give the renderer one clear photo of the person you want to animate. It is cropped
        square and stored with your faces, ready to drive speech or a live call.
      </p>

      <div className="clone-body">
        <div className="clone-column">
          <div
            className={`face-drop ${dragging ? "dragging" : ""} ${prepared ? "filled" : ""}`}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); void accept(event.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            {prepared
              // Not next/image: this is a client-side data URI that never round-trips.
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={prepared.dataUri} alt="The face you uploaded" />
              : <><Upload aria-hidden="true" /><b>Drop a photo here</b><small>or click to choose · PNG, JPEG, or WebP</small></>}
          </div>
          <input
            ref={fileRef} type="file" accept={ACCEPTED_IMAGES} hidden
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void accept(file);
            }}
          />
          {prepared && <button className="link-button" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload aria-hidden="true" />Choose a different photo
          </button>}
        </div>

        <div className="clone-column">
          <label className="field">
            <span>Name</span>
            <input value={label} onChange={event => setLabel(event.currentTarget.value)} placeholder="e.g. Akash" maxLength={40} />
          </label>
          {prepared && <div className="clone-clip">
            <div>
              <b>Ready to use</b>
              <small>{(prepared.bytes / 1024).toFixed(0)} KB · 768×768 JPEG · from {prepared.sourceWidth}×{prepared.sourceHeight}</small>
            </div>
          </div>}
          {(blocker || advice) && <p className={`clone-hint ${blocker ? "blocking" : ""}`}>{blocker ?? advice}</p>}
          {error && <p className="clone-hint blocking">{error}</p>}
        </div>
      </div>

      <div className="modal-actions">
        <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="primary" disabled={!ready} onClick={create}>{busy ? "Preparing…" : "Add face"}</button>
      </div>
    </section>
  </div>;
}
