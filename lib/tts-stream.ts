"use client";

/**
 * Playing speech as it is generated.
 *
 * `POST /api/tts` with `stream: true` pipes the encoder's output through as it arrives, so
 * the audio can start before the clip exists. Media Source Extensions is what turns that
 * stream into something an `<audio>` element will play: fragments are appended to a
 * SourceBuffer one at a time, and playback begins on the first of them.
 *
 * MP3 is the format because it is the one MSE accepts as a bare elementary stream —
 * `audio/mpeg` needs no container. Where MSE is unavailable the caller falls back to
 * waiting for the whole clip, which is what `canStreamSpeech` is for.
 */

const CODEC = "audio/mpeg";

export function canStreamSpeech() {
  return typeof window !== "undefined"
    && typeof MediaSource !== "undefined"
    && MediaSource.isTypeSupported(CODEC);
}

function once(target: EventTarget, event: string) {
  return new Promise<void>(resolve => target.addEventListener(event, () => resolve(), { once: true }));
}

export type SpeechStream = {
  /** Object URL to hand an `<audio>` element. Revoke it when the clip is discarded. */
  url: string;
  /** Resolves when the whole clip has been appended. */
  done: Promise<void>;
};

export async function streamSpeech(
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<SpeechStream> {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: true, format: "mp3" }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Speech synthesis failed (${response.status}).`);
  }

  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);

  const done = (async () => {
    const reader = response.body!.getReader();
    try {
      await once(mediaSource, "sourceopen");
      const buffer = mediaSource.addSourceBuffer(CODEC);
      while (!signal.aborted) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        if (!value?.byteLength) continue;
        if (buffer.updating) await once(buffer, "updateend");
        if (signal.aborted) break;
        buffer.appendBuffer(value as BufferSource);
        await once(buffer, "updateend");
      }
      if (!signal.aborted && mediaSource.readyState === "open") {
        if (buffer.updating) await once(buffer, "updateend");
        mediaSource.endOfStream();
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  })();

  return { url, done };
}
