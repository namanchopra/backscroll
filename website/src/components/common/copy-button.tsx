"use client";

import { useRef, useState } from "react";

interface CopyButtonProps {
  /** The exact text written to the clipboard. */
  value: string;
  /** Accessible label describing what is being copied. */
  label?: string;
}

/**
 * Faithful port of the mockup's `.copy` button: copies `value` to the
 * clipboard and swaps its label to "copied" for 1200ms.
 */
export function CopyButton({ value, label = "Copy command" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* clipboard may be unavailable (insecure context) — fail silently */
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      className="copy"
      onClick={handleCopy}
      aria-label={copied ? "Copied to clipboard" : label}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
