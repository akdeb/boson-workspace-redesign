"use client";

/** Browser-side audio helpers for voice cloning: record, transcode to WAV, and play back. */

export const CLONE_MIN_SECONDS = 5;
export const CLONE_MAX_SECONDS = 30;
export const CLONE_MAX_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_AUDIO = ".wav,.mp3,.m4a,.aac,.flac,.opus,.ogg,.webm,audio/*";

export function base64FromBytes(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export type ClonableClip = {
  /** Data URI, which the voices API accepts directly as `ref_audio`. */
  dataUri: string;
  seconds: number;
  bytes: number;
  /** Object URL for local playback; revoke it when the clip is replaced. */
  previewUrl: string;
  filename: string;
};

/**
 * Decode any browser-playable audio and re-encode it as 24 kHz mono WAV.
 *
 * MediaRecorder produces a WebM container the TTS API does not list as supported, and an
 * uploaded file may be any of a dozen formats, so everything is normalised to one shape the
 * API definitely accepts. Decoding also gives us the true duration to validate against.
 */
export async function toClonableClip(blob: Blob, filename: string): Promise<ClonableClip> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const context = new AudioContext();
  try {
    // decodeAudioData detaches the buffer it is given, so decode a copy.
    const decoded = await context.decodeAudioData(bytes.slice().buffer);
    const channel = decoded.getChannelData(0);

    // Downmix to mono by averaging, then resample to 24 kHz with linear interpolation.
    const mono = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      let sum = 0;
      for (let track = 0; track < decoded.numberOfChannels; track += 1) sum += decoded.getChannelData(track)[index];
      mono[index] = sum / decoded.numberOfChannels;
    }

    const targetRate = 24_000;
    const ratio = decoded.sampleRate / targetRate;
    const length = Math.floor(mono.length / ratio);
    const resampled = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const position = index * ratio;
      const before = Math.floor(position);
      const fraction = position - before;
      const next = Math.min(before + 1, mono.length - 1);
      resampled[index] = mono[before] * (1 - fraction) + mono[next] * fraction;
    }

    const wav = encodeWav(resampled, targetRate);
    return {
      dataUri: `data:audio/wav;base64,${base64FromBytes(wav)}`,
      seconds: decoded.duration,
      bytes: wav.byteLength,
      previewUrl: URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" })),
      filename,
    };
  } finally {
    void context.close();
  }
}

export function clipProblem(clip: ClonableClip | null) {
  if (!clip) return "Record or upload a reference clip.";
  if (clip.seconds < 3) return "The clip is under 3 seconds — the API needs at least that much.";
  if (clip.bytes > CLONE_MAX_BYTES) return "The clip is over the 10 MB limit.";
  return null;
}

/** Advisory, not blocking: outside 5–30 s still works, it just clones less faithfully. */
export function clipAdvice(clip: ClonableClip | null) {
  if (!clip) return null;
  if (clip.seconds < CLONE_MIN_SECONDS) return `${CLONE_MIN_SECONDS}–${CLONE_MAX_SECONDS} seconds clones best.`;
  if (clip.seconds > CLONE_MAX_SECONDS) return `Long clips are trimmed by the model — ${CLONE_MIN_SECONDS}–${CLONE_MAX_SECONDS} seconds is ideal.`;
  return null;
}

export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  get active() {
    return this.recorder?.state === "recording";
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
    this.recorder.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder) { reject(new Error("Nothing is recording.")); return; }
      recorder.onstop = () => {
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.recorder = null;
        resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.stop();
    });
  }

  cancel() {
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

/**
 * A single shared <audio> element for previews, so starting one preview stops the last.
 * Returns the element so callers can hook `ended`.
 */
let previewAudio: HTMLAudioElement | null = null;

export function playPreview(url: string) {
  if (!previewAudio) previewAudio = new Audio();
  previewAudio.pause();
  previewAudio.src = url;
  void previewAudio.play().catch(() => { /* autoplay refusal is not worth surfacing */ });
  return previewAudio;
}

export function stopPreview() {
  previewAudio?.pause();
}
