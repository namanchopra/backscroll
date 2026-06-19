import type { Metadata } from "next";
import Link from "next/link";
import { NoiseOverlay } from "@/components/effects/noise-overlay";
import { DotGrid } from "@/components/effects/dot-grid";
import { Glow } from "@/components/effects/glow";

export const metadata: Metadata = {
  title: "Not found — Backscroll",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <NoiseOverlay />
      <DotGrid />
      <Glow />
      <main id="main" className="hero" style={{ minHeight: "70vh" }}>
        <div className="wrap">
          <span className="eyebrow">
            <span className="rec" aria-hidden="true" />
            404
          </span>
          <h1 style={{ maxWidth: "18ch" }}>
            That command <span className="hl">isn&apos;t in history.</span>
          </h1>
          <p className="sub">
            The page you were looking for couldn&apos;t be found.
          </p>
          <div className="hero-cta">
            <Link className="btn amber" href="/">
              Back home
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
