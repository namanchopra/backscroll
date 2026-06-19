"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  /** Target value to count up to. */
  to: number;
  /** Suffix appended after the number (e.g. "%"). */
  suffix?: string;
}

/**
 * Count-up number that animates once it scrolls into view.
 *
 * Faithful port of the mockup's counter logic: step = max(1, round(to/24)),
 * advanced every 22ms until it reaches `to`. The trigger is an
 * IntersectionObserver instead of the original scroll handler. Respects
 * prefers-reduced-motion by jumping straight to the final value.
 */
export function AnimatedCounter({ to, suffix = "" }: AnimatedCounterProps) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const start = () => {
      if (started.current) return;
      started.current = true;

      if (reduceMotion || to === 0) {
        setValue(to);
        return;
      }

      let i = 0;
      const step = Math.max(1, Math.round(to / 24));
      const timer = setInterval(() => {
        i += step;
        if (i >= to) {
          i = to;
          clearInterval(timer);
        }
        setValue(i);
      }, 22);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            start();
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.25 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [to]);

  return (
    <span ref={ref}>
      {value}
      {suffix}
    </span>
  );
}
