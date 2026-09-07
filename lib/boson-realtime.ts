import { buildSessionPayload, type AgentConfig } from "@/lib/agent-config";
import { runTool, type ToolDefinition } from "@/lib/tools";

export const BOSON_AUDIO_RATE = 24_000;

/** Script may only close a socket with 1000 or 3000-4999; 1011 is reserved for endpoints. */
const CLOSE_APPLICATION_ERROR = 4000;

/** How many times to re-establish a session that the gateway dropped for a transient reason. */
const MAX_SESSION_RETRIES = 3;

/**
 * How much speech to gather before cutting a segment for the renderer.
 *
 * The first cut is short so something appears quickly; later ones are longer because by
 * then the avatar is already talking and fewer seams look better than a faster one. A
 * trailing scrap shorter than the minimum is folded into the previous segment rather than
 * rendered on its own.
 */
const FIRST_SEGMENT_SECONDS = 1.5;
const SEGMENT_SECONDS = 3;
const MIN_SEGMENT_SECONDS = 0.4;

function closeQuietly(socket: WebSocket | null) {
  if (!socket || socket.readyState >= WebSocket.CLOSING) return;
  try { socket.close(CLOSE_APPLICATION_ERROR, "client ending errored session"); }
  catch { /* already closing; nothing left to do */ }
}

/**
 * The realtime gateway validates a non-`default` voice against the voices API when the
 * session is configured, so that endpoint being rate-limited takes the whole session down
 * with it. It is worth naming, because the fix is to wait rather than to change anything.
 */
export function isVoiceRateLimit(message: string) {
  return /voices API returned HTTP 429/i.test(message)
    || (/could not validate voice/i.test(message) && /429|rate limit/i.test(message));
}

/** The gateway's own wording, which `fail` matches on before rewriting it for the UI. */
function rawErrorMessage(error: unknown) {
  const message = typeof error === "object" && error && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  return message || "Higgs Realtime returned an error.";
}

export type BosonActivity = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

type ServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  text?: string;
  item_id?: string;
  item?: { id?: string; type?: string };
  /** Tool call fields on `response.function_call_arguments.*`. */
  call_id?: string;
  name?: string;
  arguments?: string;
  error?: unknown;
};

type StartOptions = {
  config: AgentConfig;
  /** The tools this agent may call, already filtered to `config.toolIds`. */
  tools: ToolDefinition[];
};

export type AudioSegment = {
  wavBase64: string;
  /** Offset of this segment from the start of the turn's audio, in seconds. */
  startSeconds: number;
  durationSeconds: number;
  /** True for the last segment of the turn. */
  final: boolean;
};

/** One entry in the live tool-call log. */
export type ToolCallEvent = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  durationMs?: number;
  output?: string;
  error?: string;
};

type Callbacks = {
  onActivity: (activity: BosonActivity) => void;
  onMicLevel: (level: number) => void;
  /** How loud the agent's own voice is right now, so the orb moves while it speaks. */
  onOutputLevel?: (level: number) => void;
  onError: (message: string | null) => void;
  onTranscript: (role: "user" | "agent", text: string, latencyMs?: number) => void;
  /** Fires when a tool call starts and again when it settles, keyed by `callId`. */
  onToolCall?: (event: ToolCallEvent) => void;
  /**
   * The caller spoke over the agent, so the turn in flight is being abandoned. Anything
   * driven by that turn's audio — a talking-head render, say — should stop too.
   */
  onBargeIn?: () => void;
  /** The agent called `end_call` and has finished speaking, so the session is over. */
  onAgentHangUp?: () => void;
  /**
   * Fires once per completed agent turn with that turn's speech as a base64 WAV,
   * so a caller can drive a talking-head renderer from the live audio.
   */
  onAgentUtterance?: (wavBase64: string) => void;
  /** The turn's first sample is about to be heard — the origin for the audio clock. */
  onTurnAudioStart?: () => void;
  /**
   * A slice of the turn's speech, emitted while the turn is still being generated.
   *
   * Waiting for a whole turn before rendering makes the avatar's delay grow with the length
   * of the reply. Cutting the audio into segments lets rendering start after the first
   * second or so, which keeps the delay roughly constant however long the agent talks.
   */
  onAudioSegment?: (segment: AudioSegment) => void;
};

const CAPTURE_WORKLET = `
class BosonCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = Math.round(sampleRate * 0.1);
    this.buffer = new Float32Array(this.frameSize);
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) {
      this.buffer[this.length++] = channel[index];
      if (this.length === this.frameSize) {
        const frame = this.buffer.slice();
        this.port.postMessage(frame.buffer, [frame.buffer]);
        this.buffer = new Float32Array(this.frameSize);
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor("boson-capture-processor", BosonCaptureProcessor);
`;

const PLAYBACK_WORKLET = `
class BosonPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 24000 * 12;
    this.ring = new Float32Array(this.size);
    this.read = 0;
    this.write = 0;
    this.available = 0;
    this.played = 0;
    this.wasPlaying = false;
    this.levelSum = 0;
    this.levelCount = 0;
    this.levelBlocks = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "samples") this.push(new Int16Array(data.payload));
      if (data.type === "reset") this.played = 0;
      if (data.type === "flush") {
        this.available = 0;
        this.read = this.write;
        this.wasPlaying = false;
        this.port.postMessage({ type: "flushed", played: this.played });
      }
    };
  }
  push(samples) {
    for (let index = 0; index < samples.length; index += 1) {
      this.ring[this.write] = samples[index] / 32768;
      this.write = (this.write + 1) % this.size;
      if (this.available < this.size) this.available += 1;
      else this.read = (this.read + 1) % this.size;
    }
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;
    let playedAny = false;
    for (let index = 0; index < output.length; index += 1) {
      if (this.available > 0) {
        output[index] = this.ring[this.read];
        this.read = (this.read + 1) % this.size;
        this.available -= 1;
        this.played += 1;
        playedAny = true;
      } else output[index] = 0;
    }
    if (playedAny) this.wasPlaying = true;
    else if (this.wasPlaying) {
      this.wasPlaying = false;
      this.port.postMessage({ type: "drained" });
    }
    // The orb reacts to the agent's voice, not just the caller's, so the level of what is
    // actually leaving the speaker is reported alongside. Every eighth block is about 20 ms
    // at 48 kHz — often enough to look alive, rare enough not to flood the main thread.
    let sum = 0;
    for (let index = 0; index < output.length; index += 1) sum += output[index] * output[index];
    this.levelSum += sum;
    this.levelCount += output.length;
    if (++this.levelBlocks >= 8) {
      this.port.postMessage({ type: "level", value: Math.sqrt(this.levelSum / this.levelCount) });
      this.levelBlocks = 0; this.levelSum = 0; this.levelCount = 0;
    }
    return true;
  }
}
registerProcessor("boson-playback-processor", BosonPlaybackProcessor);
`;

async function addWorklet(context: BaseAudioContext, source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function base64FromBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function bufferFromBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function wavFromPcm16(chunks: ArrayBuffer[], sampleRate: number) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(44 + total);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + total, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, total, true);

  const bytes = new Uint8Array(buffer);
  let offset = 44;
  for (const chunk of chunks) {
    bytes.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return base64FromBuffer(buffer);
}

function floatToPcm16(input: Float32Array) {
  const pcm = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm.buffer;
}

function createLowpass(cutoff: number, sampleRate: number) {
  const omega = (2 * Math.PI * cutoff) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * 0.707);
  const a0 = 1 + alpha;
  const b0 = ((1 - cosine) / 2) / a0;
  const b1 = (1 - cosine) / a0;
  const b2 = b0;
  const a1 = (-2 * cosine) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  return (input: Float32Array) => {
    const output = new Float32Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const x = input[index];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      output[index] = y;
    }
    return output;
  };
}

function createResampler(inputRate: number, outputRate: number) {
  const ratio = inputRate / outputRate;
  const lowpass = ratio > 1 ? createLowpass(outputRate * 0.45, inputRate) : null;
  let previous = 0;
  let hasPrevious = false;
  let position = 0;

  return (input: Float32Array) => {
    if (!input.length || ratio === 1) return input.slice();
    const filtered = lowpass ? lowpass(input) : input;
    const source = hasPrevious ? new Float32Array(filtered.length + 1) : filtered;
    if (hasPrevious) {
      source[0] = previous;
      source.set(filtered, 1);
    }
    const output: number[] = [];
    let cursor = position;
    while (cursor + 1 < source.length) {
      const before = Math.floor(cursor);
      const fraction = cursor - before;
      output.push(source[before] * (1 - fraction) + source[before + 1] * fraction);
      cursor += ratio;
    }
    previous = source[source.length - 1];
    hasPrevious = true;
    position = Math.max(0, cursor - (source.length - 1));
    return Float32Array.from(output);
  };
}

class MicrophoneCapture {
  private rate = BOSON_AUDIO_RATE;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;

  constructor(
    private readonly onChunk: (audio: string) => void,
    private readonly onLevel: (level: number) => void,
  ) {}

  async start(targetRate: number = BOSON_AUDIO_RATE) {
    if (this.node) return;
    this.rate = targetRate;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
    });
    const context = new AudioContext();
    this.context = context;
    await addWorklet(context, CAPTURE_WORKLET);
    const resample = createResampler(context.sampleRate, targetRate);
    this.source = context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(context, "boson-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.node.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      const frame = new Float32Array(data);
      let energy = 0;
      for (const sample of frame) energy += sample * sample;
      this.onLevel(Math.sqrt(energy / frame.length));
      const converted = resample(frame);
      if (converted.length) this.onChunk(base64FromBuffer(floatToPcm16(converted)));
    };
    this.source.connect(this.node);
    this.node.connect(context.destination);
    if (context.state === "suspended") await context.resume();
  }

  async stop() {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.onLevel(0);
  }
}

class AudioPlayer {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private flushResolvers: Array<(milliseconds: number) => void> = [];

  private rate = BOSON_AUDIO_RATE;
  /**
   * Held here rather than only on the gain node, which is rebuilt with every audio context.
   * A session that reconnects would otherwise come back at full volume — and in synced mode
   * that means the reply is heard twice: once live, once again from the video.
   */
  private muted = false;

  constructor(
    private readonly onDrained: () => void,
    private readonly onLevel: (level: number) => void = () => {},
  ) {}

  /** The playback rate is fixed for the life of the context, so it is set at session start. */
  async start(rate: number = BOSON_AUDIO_RATE) {
    if (!this.context) {
      this.rate = rate;
      this.context = new AudioContext({ sampleRate: rate });
      await addWorklet(this.context, PLAYBACK_WORKLET);
      this.node = new AudioWorkletNode(this.context, "boson-playback-processor", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.node.port.onmessage = ({ data }: MessageEvent<{ type: string; played?: number; value?: number }>) => {
        if (data.type === "level") { this.onLevel(this.muted ? 0 : data.value ?? 0); return; }
        if (data.type === "flushed") {
          this.flushResolvers.shift()?.(((data.played ?? 0) / this.rate) * 1000);
          this.onDrained();
        }
        if (data.type === "drained") this.onDrained();
      };
      this.gain = this.context.createGain();
      this.gain.gain.value = this.muted ? 0 : 1;
      this.node.connect(this.gain);
      this.gain.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  enqueue(base64: string) {
    const buffer = bufferFromBase64(base64);
    this.node?.port.postMessage({ type: "samples", payload: buffer }, [buffer]);
  }

  reset() {
    this.node?.port.postMessage({ type: "reset" });
  }

  setMuted(muted: boolean) {
    // Recorded even with no context yet, so a mute chosen before the call starts sticks.
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 1;
  }

  flush() {
    if (!this.node) return Promise.resolve(0);
    return new Promise<number>((resolve) => {
      this.flushResolvers.push(resolve);
      this.node?.port.postMessage({ type: "flush" });
    });
  }

  async stop() {
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
    this.node = null;
    this.gain = null;
    this.flushResolvers = [];
    // `muted` deliberately survives: it is the caller's preference, not context state.
  }
}

export class BosonRealtimeClient {
  private socket: WebSocket | null = null;
  private currentItemId: string | null = null;
  private utteranceChunks: ArrayBuffer[] = [];
  /** Audio gathered for the next segment, and where that segment sits within the turn. */
  private segmentChunks: ArrayBuffer[] = [];
  private segmentSamples = 0;
  private segmentStartSample = 0;
  private turnAudioStarted = false;
  /** When the agent was last handed the turn, and how long it then took to start speaking. */
  private turnHandedOverAt: number | null = null;
  private replyLatencyMs: number | null = null;
  private openingPrompt = "";
  private running = false;
  private activity: BosonActivity = "idle";
  /** The session's tools, by the `name` the model calls them under. */
  private tools = new Map<string, ToolDefinition>();
  private manualTurns = false;
  private pendingToolCalls = 0;
  /** Set by the `end_call` control tool; acted on once the goodbye has finished playing. */
  private hangUpAfterReply = false;
  private hangUpTimer: number | null = null;
  /** Kept so a session killed by a transient server-side error can be re-established. */
  private lastOptions: StartOptions | null = null;
  private retries = 0;
  private retryTimer: number | null = null;
  private outputRate = BOSON_AUDIO_RATE;
  private textReply = "";
  private readonly microphone: MicrophoneCapture;
  private readonly player: AudioPlayer;

  constructor(private readonly callbacks: Callbacks) {
    this.microphone = new MicrophoneCapture(
      (audio) => this.send({ type: "input_audio_buffer.append", audio }),
      callbacks.onMicLevel,
    );
    this.player = new AudioPlayer(
      () => {
        if (!this.running) return;
        // The agent asked to hang up and its goodbye has now finished playing.
        if (this.hangUpAfterReply) return void this.hangUp();
        this.setActivity("listening");
      },
      level => callbacks.onOutputLevel?.(level),
    );
  }

  get active() {
    return this.running;
  }

  /** True when the session hands turn-taking to the caller (`turn_detection: null`). */
  get pushToTalk() {
    return this.manualTurns;
  }

  async start(options: StartOptions, isRetry = false) {
    if (this.running) return;
    const { config, tools } = options;
    this.lastOptions = options;
    if (!isRetry) this.retries = 0;
    this.running = true;
    this.openingPrompt = config.greeting.trim();
    this.tools = new Map(tools.map(tool => [tool.name, tool]));
    this.manualTurns = config.turnDetection.type === "manual";
    this.outputRate = config.outputRate;
    this.textReply = "";
    this.callbacks.onError(null);
    this.setActivity("connecting");

    try {
      await Promise.all([this.player.start(config.outputRate), this.microphone.start(config.inputRate)]);
      const response = await fetch("/api/boson/token", { method: "POST" });
      const body = await response.json() as { value?: string; error?: string };
      if (!response.ok || !body.value) throw new Error(body.error ?? `Token request failed (${response.status}).`);
      if (!this.running) return;

      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(
          "wss://api.boson.ai/v1/realtime?model=higgs-realtime",
          ["realtime", `bai-client-secret.${body.value}`],
        );
        this.socket = socket;
        socket.onopen = () => {
          this.send({ type: "session.update", session: buildSessionPayload(config, tools) });
          this.setActivity("listening");
          resolve();
        };
        socket.onmessage = (event) => this.handleMessage(event);
        socket.onerror = () => reject(new Error("Could not connect to Higgs Realtime."));
        socket.onclose = (event) => {
          if (this.running) {
            this.socket = null;
            this.callbacks.onError(event.reason || `Realtime session closed (${event.code}).`);
            this.setActivity("error");
            void this.stopAudio();
          }
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start the realtime session.";
      this.callbacks.onError(message);
      this.setActivity("error");
      await this.stopAudio();
      throw error;
    }
  }

  async stop() {
    this.running = false;
    if (this.retryTimer !== null) { window.clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.retries = 0;
    this.lastOptions = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "user ended session");
    await this.stopAudio();
    this.currentItemId = null;
    this.utteranceChunks = [];
    this.resetSegments();
    this.turnHandedOverAt = null;
    this.replyLatencyMs = null;
    this.openingPrompt = "";
    this.tools = new Map();
    this.manualTurns = false;
    this.pendingToolCalls = 0;
    this.textReply = "";
    this.callbacks.onError(null);
    this.setActivity("idle");
  }

  /**
   * End the user's turn by hand. Only meaningful with `turn_detection: "manual"`, where the
   * server buffers audio until we commit it and never starts a response on its own.
   */
  commitTurn() {
    if (!this.running || !this.manualTurns) return;
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
    this.turnHandedOverAt = Date.now();
    this.setActivity("thinking");
  }

  /** Discard buffered audio without committing it — the manual-mode equivalent of a retake. */
  clearTurn() {
    if (!this.running || !this.manualTurns) return;
    this.send({ type: "input_audio_buffer.clear" });
    this.setActivity("listening");
  }

  async setMicrophoneEnabled(enabled: boolean) {
    if (!this.running) return;
    if (enabled) await this.microphone.start();
    else await this.microphone.stop();
  }

  setSpeakerMuted(muted: boolean) {
    this.player.setMuted(muted);
  }

  private async stopAudio() {
    this.running = false;
    await Promise.allSettled([this.microphone.stop(), this.player.stop()]);
  }

  private send(event: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  /**
   * Tear the session down after a server-side error.
   *
   * `WebSocket.close()` only accepts 1000 or 3000-4999 from script — a status like 1011 is
   * reserved for the endpoint itself and throws `InvalidAccessError`, which would otherwise
   * escape the message handler and bury the error that actually caused it.
   */
  private fail(rawMessage: string) {
    this.running = false;

    // A rate-limited voice lookup is the gateway being busy, not the session being wrong.
    // Reconnecting after a moment is the whole fix, so do it rather than making the caller.
    const rateLimited = isVoiceRateLimit(rawMessage);
    if (rateLimited && this.lastOptions && this.retries < MAX_SESSION_RETRIES) {
      this.retries += 1;
      this.callbacks.onError(
        `The voices API is rate limited, so the session could not validate its voice. Reconnecting (${this.retries}/${MAX_SESSION_RETRIES})…`,
      );
      this.setActivity("connecting");
      const socket = this.socket;
      this.socket = null;
      closeQuietly(socket);
      void this.stopAudio();
      const options = this.lastOptions!;
      const backoffMs = 2000 * this.retries;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        void this.start(options, true).catch(() => { /* surfaced by the next failure */ });
      }, backoffMs);
      return;
    }

    this.callbacks.onError(
      rateLimited
        ? "The voices API is still rate limited. Wait a moment, or switch this agent to the Default voice."
        : rawMessage,
    );
    this.setActivity("error");
    const socket = this.socket;
    this.socket = null;
    closeQuietly(socket);
    void this.stopAudio();
  }

  private handleMessage(message: MessageEvent) {
    let event: ServerEvent;
    try {
      event = JSON.parse(String(message.data)) as ServerEvent;
    } catch {
      return;
    }

    if (event.type === "session.created" && this.openingPrompt) {
      this.send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: this.openingPrompt }] },
      });
      this.send({ type: "response.create" });
      this.turnHandedOverAt = Date.now();
      this.openingPrompt = "";
    } else if (event.type === "response.created") {
      this.player.reset();
      this.replyLatencyMs = null;
      this.setActivity("thinking");
    } else if (event.type === "response.output_item.added") {
      if (event.item?.type === "message" && event.item.id) this.currentItemId = event.item.id;
    } else if (event.type === "response.output_audio.delta" && event.delta) {
      if (event.item_id) this.currentItemId = event.item_id;
      if (this.replyLatencyMs === null && this.turnHandedOverAt !== null) {
        this.replyLatencyMs = Date.now() - this.turnHandedOverAt;
      }
      if (!this.turnAudioStarted) {
        this.turnAudioStarted = true;
        this.callbacks.onTurnAudioStart?.();
      }
      this.player.enqueue(event.delta);
      const wantsAudio = this.callbacks.onAgentUtterance || this.callbacks.onAudioSegment;
      if (wantsAudio) {
        const pcm = bufferFromBase64(event.delta);
        if (this.callbacks.onAgentUtterance) this.utteranceChunks.push(pcm);
        if (this.callbacks.onAudioSegment) {
          this.segmentChunks.push(pcm);
          this.segmentSamples += pcm.byteLength / 2;
          const target = this.segmentStartSample === 0 ? FIRST_SEGMENT_SECONDS : SEGMENT_SECONDS;
          if (this.segmentSamples >= target * this.outputRate) this.flushSegment(false);
        }
      }
      this.setActivity("speaking");
    } else if (event.type === "response.output_audio.done") {
      this.flushUtterance();
      this.flushSegment(true);
    } else if (event.type === "response.output_text.delta" && event.delta) {
      // Text-only sessions (`output_modalities: ["text"]`) stream here instead of as audio.
      this.textReply += event.delta;
      this.setActivity("thinking");
    } else if (event.type === "response.output_text.done") {
      const text = (event.text ?? this.textReply).trim();
      this.textReply = "";
      if (text) this.callbacks.onTranscript("agent", text, this.replyLatencyMs ?? undefined);
    } else if (event.type === "response.function_call_arguments.done") {
      void this.runToolCall(event);
    } else if (event.type === "input_audio_buffer.speech_started") {
      // The turn was cut short, so its audio no longer matches what the listener heard.
      this.utteranceChunks = [];
      this.resetSegments();
      this.callbacks.onBargeIn?.();
      void this.handleBargeIn();
    } else if (event.type === "input_audio_buffer.speech_stopped") {
      this.turnHandedOverAt = Date.now();
      this.setActivity("thinking");
    } else if (event.type === "response.done") {
      this.flushUtterance();
      this.flushSegment(true);
      // A response that ended in a tool call is not the end of the turn: the follow-up
      // response is already on its way, so leave the state alone until it lands.
      if (this.activity !== "speaking" && !this.pendingToolCalls) this.setActivity("listening");
    } else if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript?.trim()) {
      this.callbacks.onTranscript("user", event.transcript.trim());
    } else if (event.type === "response.output_audio_transcript.done" && event.transcript?.trim()) {
      this.callbacks.onTranscript("agent", event.transcript.trim(), this.replyLatencyMs ?? undefined);
    } else if (event.type === "error") {
      console.error("Boson realtime error", event.error ?? event);
      this.fail(rawErrorMessage(event.error));
    }
  }

  /**
   * Execute a tool the model asked for, hand the result back as a `function_call_output`,
   * and ask for the continuation. This is the client's half of the tool loop —
   * https://docs.boson.ai/models/higgs-realtime/guides/tool-calling
   */
  private async runToolCall(event: ServerEvent) {
    const callId = event.call_id;
    const name = event.name;
    if (!callId || !name) return;

    let args: Record<string, unknown> = {};
    try {
      args = event.arguments ? JSON.parse(event.arguments) as Record<string, unknown> : {};
    } catch {
      // Malformed arguments are still worth reporting back so the model can retry.
    }

    const tool = this.tools.get(name);
    this.pendingToolCalls += 1;
    this.callbacks.onToolCall?.({ callId, name, args, status: "running" });

    let output: string;
    let settled: ToolCallEvent;
    if (!tool) {
      output = JSON.stringify({ error: `No tool named ${name} is configured.` });
      settled = { callId, name, args, status: "error", output, error: "Tool not found", durationMs: 0 };
    } else {
      const run = await runTool(tool, args);
      output = run.output || JSON.stringify({ ok: run.ok });
      settled = {
        callId, name, args,
        status: run.ok ? "ok" : "error",
        durationMs: run.durationMs,
        output,
        error: run.error,
      };
    }
    this.callbacks.onToolCall?.(settled);
    this.pendingToolCalls = Math.max(0, this.pendingToolCalls - 1);

    // Hanging up now would cut off the goodbye, so the flag is spent when the reply ends.
    if (tool?.binding.kind === "control" && tool.binding.action === "end_call") {
      this.hangUpAfterReply = true;
    }

    if (!this.running) return;
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output },
    });

    // Ending the call is the exception: asking for another response invites the model to
    // narrate the hang-up instead of performing it, which is how "I'll do that now" ended
    // up between the goodbye and the silence. Its closing line was the turn it spoke
    // *before* reaching for the tool, so there is nothing left to say.
    if (this.hangUpAfterReply) {
      this.finishHangUp();
      return;
    }

    this.send({ type: "response.create" });
    this.turnHandedOverAt = Date.now();
  }

  /**
   * Let whatever is already playing finish, then hang up.
   *
   * The drain callback normally gets there first; the timer is only so a call cannot be
   * left open by audio that never drains.
   */
  private finishHangUp() {
    if (this.hangUpTimer !== null) window.clearTimeout(this.hangUpTimer);
    this.hangUpTimer = window.setTimeout(() => this.hangUp(), 2500);
  }

  private hangUp() {
    if (!this.hangUpAfterReply) return;
    this.hangUpAfterReply = false;
    if (this.hangUpTimer !== null) { window.clearTimeout(this.hangUpTimer); this.hangUpTimer = null; }
    void this.stop().then(() => this.callbacks.onAgentHangUp?.());
  }

  private resetSegments() {
    this.segmentChunks = [];
    this.segmentSamples = 0;
    this.segmentStartSample = 0;
    this.turnAudioStarted = false;
  }

  /**
   * Hand the gathered speech to the renderer as one segment.
   *
   * A final scrap below the minimum is dropped rather than rendered: a third of a second of
   * video costs as much to set up as a useful clip and would only add a seam at the end.
   */
  private flushSegment(final: boolean) {
    const samples = this.segmentSamples;
    if (!samples || !this.callbacks.onAudioSegment) {
      if (final) this.resetSegments();
      return;
    }
    if (final && samples < MIN_SEGMENT_SECONDS * this.outputRate && this.segmentStartSample > 0) {
      this.resetSegments();
      return;
    }

    const chunks = this.segmentChunks;
    const startSeconds = this.segmentStartSample / this.outputRate;
    this.segmentChunks = [];
    this.segmentSamples = 0;
    this.segmentStartSample += samples;
    if (final) this.turnAudioStarted = false;

    this.callbacks.onAudioSegment({
      wavBase64: wavFromPcm16(chunks, this.outputRate),
      startSeconds,
      durationSeconds: samples / this.outputRate,
      final,
    });
    if (final) this.segmentStartSample = 0;
  }

  private flushUtterance() {
    if (!this.utteranceChunks.length) return;
    const chunks = this.utteranceChunks;
    this.utteranceChunks = [];
    this.callbacks.onAgentUtterance?.(wavFromPcm16(chunks, this.outputRate));
  }

  private async handleBargeIn() {
    this.setActivity("listening");
    const playedMilliseconds = await this.player.flush();
    if (this.currentItemId && playedMilliseconds > 0) {
      this.send({
        type: "conversation.item.truncate",
        item_id: this.currentItemId,
        content_index: 0,
        audio_end_ms: Math.round(playedMilliseconds),
      });
    }
    this.currentItemId = null;
  }

  private setActivity(activity: BosonActivity) {
    this.activity = activity;
    this.callbacks.onActivity(activity);
  }
}
