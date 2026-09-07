import { createBosonVoice, deleteBosonVoice, errorMessage, errorStatus, listBosonVoices, transcribeAudio, voiceId, type BosonVoice } from "@/lib/boson";
import type { VoiceRecord } from "@/lib/store/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * A voice registered before titles were supported — or by another client — comes back with
 * no label at all, so the id's hash prefix stands in until the local store supplies one.
 */
function toRecord(voice: BosonVoice): VoiceRecord {
  const id = voiceId(voice);
  return {
    id,
    label: (voice.title ?? voice.description ?? "").trim() || `Voice ${id.replace("voice_", "").slice(0, 6)}`,
    kind: "cloned",
    tag: "Cloned",
    description: (voice.description ?? "").trim() || "Cloned from your reference audio.",
    createdAt: voice.created_at ?? undefined,
    refText: voice.ref_text,
  };
}

/**
 * The voices list is cached because it is not just our own traffic that pays for it: the
 * realtime gateway validates a session's voice against this same endpoint, so polling it
 * from the UI can rate-limit an agent out of starting a call. The list only changes when
 * this app creates a voice, which busts the cache directly.
 */
const LIST_TTL_MS = 60_000;
let cached: { at: number; voices: VoiceRecord[] } | null = null;
let inFlight: Promise<VoiceRecord[]> | null = null;

function readVoices() {
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return Promise.resolve(cached.voices);
  // Collapse concurrent misses into one upstream call.
  inFlight ??= listBosonVoices()
    .then(voices => {
      const records = voices.map(toRecord);
      cached = { at: Date.now(), voices: records };
      return records;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Every cloned voice registered under this API key. */
export async function GET() {
  try {
    return Response.json({ voices: await readVoices() });
  } catch (error) {
    // A rate-limited refresh should not blank the picker: serve the last good list.
    if (cached) return Response.json({ voices: cached.voices, stale: true });
    return Response.json({ error: errorMessage(error, "Could not list voices.") }, { status: errorStatus(error) });
  }
}

type CreateVoiceBody = { refAudio?: string; refText?: string; label?: string; description?: string };

/**
 * Register a reusable cloned voice. Boson keys the id off the audio content, so posting the
 * same clip twice returns the same `voice_<sha>` rather than a duplicate.
 * https://docs.boson.ai/models/higgs-tts/voices#custom-voices
 */
export async function POST(request: Request) {
  let body: CreateVoiceBody;
  try {
    body = await request.json() as CreateVoiceBody;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const refAudio = body.refAudio?.trim();
  const label = body.label?.trim();
  if (!refAudio) return Response.json({ error: "Reference audio is required." }, { status: 400 });
  if (!label) return Response.json({ error: "Give the voice a name." }, { status: 400 });

  try {
    // Cloning needs the reference text. The caller may supply it, but typing out what you
    // just recorded is work `higgs-stt-3.1` can do, so an omitted transcript is filled in.
    const refText = body.refText?.trim() || await transcribeAudio(refAudio);
    const created = await createBosonVoice({ refAudio, refText, title: label, description: body.description?.trim() });
    const id = voiceId(created);
    if (!id) throw new Error("Boson did not return a voice id.");
    cached = null;
    return Response.json({
      voice: {
        id,
        // Re-cloning identical audio returns the original record, whose title wins.
        label: (created.title ?? "").trim() || label,
        kind: "cloned",
        tag: "Cloned",
        description: body.description?.trim() || "Cloned from your reference audio.",
        createdAt: created.created_at ?? new Date().toISOString(),
        refText: created.ref_text ?? refText,
      } satisfies VoiceRecord,
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error, "Could not create the voice.") }, { status: errorStatus(error) });
  }
}

/**
 * Remove a cloned voice.
 *
 * Boson owns the voice itself, so the delete goes upstream first. Older deployments have
 * no delete route; when that is the case the studio still stops offering the voice, by
 * recording a tombstone of its own (see `deleteVoice` in lib/db/repository.ts and the
 * `hidden` filter in useVoiceLibrary).
 */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ error: "Which voice?" }, { status: 400 });
  try {
    const upstream = await deleteBosonVoice(id);
    cached = null;
    return Response.json({ ok: true, removedUpstream: upstream.ok });
  } catch (error) {
    return Response.json({ error: errorMessage(error, "Could not delete the voice.") }, { status: errorStatus(error) });
  }
}
