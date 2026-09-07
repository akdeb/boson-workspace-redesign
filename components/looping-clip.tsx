"use client";

import { useEffect, useRef } from "react";

/**
 * A video that loops without a visible seam.
 *
 * `<video loop>` snaps from the last frame back to the first, and on a talking head that
 * cut is obvious — the pose, blink state and hair position all jump at once. Instead two
 * copies of the clip run half a period out of phase and cross-fade at the hand-over, so
 * one is always at full opacity while the other is restarting underneath.
 *
 * The clip itself is silent, so nothing has to be done about audio.
 */

/** How long the hand-over takes. Long enough to hide the jump, short enough to feel still. */
const FADE_SECONDS = 0.55;

export function LoopingClip({ src, className }: { src: string; className?: string }) {
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    let cancelled = false;
    let front = a;
    let back = b;
    let frame = 0;

    const show = (video: HTMLVideoElement, visible: boolean) => {
      video.style.opacity = visible ? "1" : "0";
    };

    const step = () => {
      if (cancelled) return;
      frame = requestAnimationFrame(step);

      const duration = front.duration;
      if (!Number.isFinite(duration) || duration <= FADE_SECONDS * 2) return;

      const remaining = duration - front.currentTime;
      if (remaining > FADE_SECONDS) return;

      // Inside the hand-over window: start the other copy and cross-fade into it.
      if (back.paused) {
        back.currentTime = 0;
        void back.play().catch(() => { /* a blocked play just means no loop */ });
      }
      const progress = Math.min(1, Math.max(0, (FADE_SECONDS - remaining) / FADE_SECONDS));
      front.style.opacity = String(1 - progress);
      back.style.opacity = String(progress);

      if (remaining <= 0.02) {
        front.pause();
        show(front, false);
        show(back, true);
        [front, back] = [back, front];
      }
    };

    show(a, true);
    show(b, false);
    a.currentTime = 0;
    void a.play().catch(() => { /* a blocked play leaves the still frame, which is fine */ });
    frame = requestAnimationFrame(step);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      a.pause();
      b.pause();
    };
  }, [src]);

  return <>
    <video ref={aRef} className={className} src={src} muted playsInline preload="auto" />
    <video ref={bRef} className={className} src={src} muted playsInline preload="auto" />
  </>;
}
