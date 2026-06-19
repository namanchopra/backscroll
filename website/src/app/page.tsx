import { NoiseOverlay } from "@/components/effects/noise-overlay";
import { DotGrid } from "@/components/effects/dot-grid";
import { Glow } from "@/components/effects/glow";
import { Navbar } from "@/components/sections/navbar";
import { Hero } from "@/components/sections/hero";
import { Features } from "@/components/sections/features";
import { Demo } from "@/components/sections/demo";
import { UiShowcase } from "@/components/sections/ui-showcase";
import { Compare } from "@/components/sections/compare";
import { Privacy } from "@/components/sections/privacy";
import { Install } from "@/components/sections/install";
import { Cta } from "@/components/sections/cta";
import { Footer } from "@/components/sections/footer";

export default function Home() {
  return (
    <>
      {/* Atmosphere: noise + dot-grid + amber glow */}
      <NoiseOverlay />
      <DotGrid />
      <Glow />

      <Navbar />

      <main id="main">
        {/* `#top` anchors the brand/footer "back to top" links, mirroring the
            mockup's <main id="top">. */}
        <span id="top" aria-hidden="true" />
        <Hero />
        <Features />
        <Demo />
        <UiShowcase />
        <Compare />
        <Privacy />
        <Install />
        <Cta />
      </main>

      <Footer />
    </>
  );
}
