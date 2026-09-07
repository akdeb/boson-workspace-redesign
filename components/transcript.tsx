"use client";

import { useCallback, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import type { ToolCallEvent } from "@/lib/boson-realtime";
import type { TranscriptEntry } from "@/lib/store/types";

/**
 * The conversation as one ordered stream.
 *
 * Turns and tool calls share a single list rather than living in separate panes, because
 * a tool call only makes sense where it happened: the agent says "let me pull that up",
 * calls `get_weather`, and reads the answer back. Split apart, the transcript reads as if
 * the agent knew the temperature by magic and something unrelated ran at the bottom.
 *
 * A call is appended the moment it starts, so it lands between the turn that triggered it
 * and the turn that uses it, then is updated in place as it settles.
 */

/** Time from the end of the caller's turn to the agent's first spoken word. */
export function formatLatency(milliseconds: number) {
  return milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(2)}s`;
}

export function useConversation() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  // The live value, for callers that need the transcript at the instant a call ends.
  const ref = useRef<TranscriptEntry[]>([]);
  ref.current = entries;

  const addTurn = useCallback((role: "user" | "agent", text: string, latencyMs?: number) => {
    setEntries(current => [...current, { kind: "turn", role, text, latencyMs }]);
  }, []);

  const addToolCall = useCallback((event: ToolCallEvent) => {
    setEntries(current => {
      const entry: TranscriptEntry = { kind: "tool", ...event };
      const index = current.findIndex(existing => existing.kind === "tool" && existing.callId === event.callId);
      if (index < 0) return [...current, entry];
      const next = [...current];
      next[index] = entry;
      return next;
    });
  }, []);

  const reset = useCallback(() => setEntries([]), []);

  return { entries, entriesRef: ref, addTurn, addToolCall, reset };
}

export function ToolCallLine({ call }: { call: Extract<TranscriptEntry, { kind: "tool" }> }) {
  return <div className={`tool-call ${call.status}`}>
    <Wrench aria-hidden="true" />
    <span>
      <b>{call.name}<code>({Object.entries(call.args).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")})</code></b>
      <small>
        {call.status === "running" ? "Calling the API…"
          : call.status === "ok" ? `Returned in ${call.durationMs} ms · ${(call.output ?? "").length} chars`
          : call.error ?? "Failed"}
      </small>
    </span>
  </div>;
}

export function Transcript({ entries, empty = "Your conversation will appear here." }: {
  entries: TranscriptEntry[]; empty?: string;
}) {
  if (!entries.length) return <div className="transcript-empty">{empty}</div>;
  return <>
    {entries.map((entry, index) => entry.kind === "tool"
      ? <div className="transcript-tool" key={`${entry.callId}-${index}`}><ToolCallLine call={entry} /></div>
      : <div className="transcript-line" key={`${entry.role}-${index}`}>
          <span className="transcript-who">
            <b className={entry.role}>{entry.role === "agent" ? "Agent" : "You"}</b>
            {entry.latencyMs !== undefined && <small title="Time from the end of your turn to the first word spoken">{formatLatency(entry.latencyMs)}</small>}
          </span>
          <p>{entry.text}</p>
        </div>)}
  </>;
}

/** The last few running/finished calls, for the compact live view. */
export function ToolActivity({ entries, limit }: { entries: TranscriptEntry[]; limit?: number }) {
  const calls = entries.filter((entry): entry is Extract<TranscriptEntry, { kind: "tool" }> => entry.kind === "tool");
  const shown = limit ? calls.slice(-limit) : calls;
  if (!shown.length) return null;
  return <div className="tool-activity" aria-live="polite">
    {shown.map(call => <ToolCallLine key={call.callId} call={call} />)}
  </div>;
}
