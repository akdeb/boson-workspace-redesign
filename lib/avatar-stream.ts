"use client";

/**
 * Plays the fragmented-MP4 stream from `/api/avatar/stream` through Media Source Extensions,
 * so the avatar starts moving while the rest of the clip is still being generated.
 *
 * https://docs.boson.ai/models/higgs-avatar/streaming-video
 */

/**
 * The renderer emits H.264 High profile level 3.0 with AAC-LC audio, verified with ffprobe
 * against a real stream. The alternatives are listed in case it ever emits a lower profile;
 * MSE rejects a buffer whose codec string does not cover the bitstream.
 */
const CODEC_CANDIDATES = [
  'video/mp4; codecs="avc1.64001E,mp4a.40.2"',
  'video/mp4; codecs="avc1.4D401E,mp4a.40.2"',
  'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
];

export function avatarStreamCodec() {
  if (typeof window === "undefined" || typeof MediaSource === "undefined") return null;
  return CODEC_CANDIDATES.find(codec => MediaSource.isTypeSupported(codec)) ?? null;
}

/** Whether this browser can play a live avatar stream at all. */
export function canStreamAvatar() {
  return avatarStreamCodec() !== null;
}

function once(target: EventTarget, event: string) {
  return new Promise<void>(resolve => target.addEventListener(event, () => resolve(), { once: true }));
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

/**
 * Resolve when the element has actually put a picture on screen.
 *
 * The first thing appended to a `SourceBuffer` is the fMP4 initialisation segment, which
 * carries no frames at all — revealing the element then shows nothing but its own
 * background until real media fragments arrive and decode. `requestVideoFrameCallback`
 * fires exactly when a frame has been presented, which is the moment worth waiting for.
 */
function firstFramePresented(video: HTMLVideoElement, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }

    const withFrameCallback = video as FrameCallbackVideo;
    if (typeof withFrameCallback.requestVideoFrameCallback === "function") {
      withFrameCallback.requestVideoFrameCallback(() => resolve());
      return;
    }

    // Firefox has no frame callback, so fall back to the element reporting that it has
    // decoded data for the current position.
    const settle = () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      for (const event of ["playing", "loadeddata", "timeupdate"]) video.removeEventListener(event, settle);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => { cleanup(); resolve(); };
    for (const event of ["playing", "loadeddata", "timeupdate"]) video.addEventListener(event, settle);
    signal.addEventListener("abort", onAbort, { once: true });
    settle();
  });
}

export type StreamHandle = {
  /** Resolves when the whole clip has been appended, or rejects if the stream failed. */
  done: Promise<void>;
  /** The renderer's id for this clip, once the response headers arrive. */
  videoId: string | null;
};

/**
 * Stream one clip into `video`. Fragments are appended one at a time — a `SourceBuffer`
 * rejects an append while it is still processing the previous one, so each write waits for
 * `updateend` before the next.
 */
export async function streamAvatarClip({ payload, video, signal, onFirstFragment, onFirstFrame }: {
  payload: Record<string, unknown>;
  video: HTMLVideoElement;
  signal: AbortSignal;
  /** The first bytes have been buffered — the clip exists, but has nothing to show yet. */
  onFirstFragment?: () => void;
  /** A frame is on screen. This is the moment to reveal the element. */
  onFirstFrame?: () => void;
}): Promise<StreamHandle> {
  const codec = avatarStreamCodec();
  if (!codec) throw new Error("This browser cannot play streamed avatar video.");

  const response = await fetch("/api/avatar/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `The avatar stream failed (${response.status}).`);
  }

  const videoId = response.headers.get("X-Video-Id") || null;
  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  video.src = objectUrl;

  const done = (async () => {
    const reader = response.body!.getReader();
    try {
      await once(mediaSource, "sourceopen");
      const buffer = mediaSource.addSourceBuffer(codec);
      let first = true;

      while (!signal.aborted) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        if (!value?.byteLength) continue;

        if (buffer.updating) await once(buffer, "updateend");
        if (signal.aborted) break;
        buffer.appendBuffer(value as BufferSource);
        await once(buffer, "updateend");

        if (first) {
          first = false;
          onFirstFragment?.();
          void firstFramePresented(video, signal).then(() => {
            if (!signal.aborted) onFirstFrame?.();
          });
          // Autoplay is allowed here: a live call only starts from a click. If it is
          // refused anyway, reveal the element regardless so the viewer can start it.
          void video.play().catch(() => { if (!signal.aborted) onFirstFrame?.(); });
        }
      }

      if (!signal.aborted && mediaSource.readyState === "open") {
        if (buffer.updating) await once(buffer, "updateend");
        mediaSource.endOfStream();
      }
    } finally {
      await reader.cancel().catch(() => {});
      URL.revokeObjectURL(objectUrl);
    }
  })();

  return { done, videoId };
}
