"use client";

import { MessageSquareText, Mic, MicOff, PhoneOff, Volume2, VolumeX } from "lucide-react";

export function CallControls({ speakerMuted, micMuted, transcriptOpen, showTranscript = true, onSpeaker, onMic, onTranscript, onEnd }: {
  speakerMuted: boolean; micMuted: boolean; transcriptOpen: boolean; showTranscript?: boolean;
  onSpeaker: () => void; onMic: () => void; onTranscript: () => void; onEnd: () => void;
}) {
  return <div className="call-controls">
    <button className={speakerMuted ? "muted" : ""} onClick={onSpeaker} aria-label={speakerMuted ? "Unmute speaker" : "Mute speaker"}>{speakerMuted ? <VolumeX /> : <Volume2 />}</button>
    <button className={micMuted ? "muted" : ""} onClick={onMic} aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}>{micMuted ? <MicOff /> : <Mic />}</button>
    {showTranscript && <button className={transcriptOpen ? "transcript-active" : ""} onClick={onTranscript} aria-label="Toggle transcript"><MessageSquareText /></button>}
    <button className="hangup" onClick={onEnd} aria-label="End session"><PhoneOff /></button>
  </div>;
}
