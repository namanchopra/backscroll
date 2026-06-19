# Backscroll — marketing site

The production marketing site for **Backscroll**, a local-first tool that records
every shell command **and its output** into a searchable store.

Built with **Next.js (App Router) + TypeScript + Tailwind CSS v4**. It is a
standalone app with its own `package.json`, `node_modules`, and build output —
fully independent of the `backscroll-cli` package at the repo root.

## Stack

- **Next.js 15** (App Router, React 19, React Server Components)
- **Tailwind CSS v4** via `@tailwindcss/postcss`
- **TypeScript** (strict mode, `@/*` path alias)
- **Fonts** loaded with `next/font/google`:
  - **Space Grotesk** — display (h1/h2, brand)
  - **Inter** — body / UI
  - **JetBrains Mono** — all terminal / command / code text

All visuals (noise overlay, dot-grid, amber glow, terminals, icons) are pure
CSS/SVG — no external image or CDN URLs.

## Local development

```bash
cd website
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build    # production build (next build)
npm run start    # serve the production build
npm run lint     # eslint (next/core-web-vitals + next/typescript)
```

## Deploy to Vercel

This site lives in the `website/` subdirectory of the Backscroll repo, so point
Vercel at that folder:

1. In Vercel, **Add New → Project** and **import** the GitHub repo
   (`github.com/namanchopra/backscroll`).
2. Under **Configure Project → Root Directory**, click **Edit** and set it to
   `website`.
3. Framework is auto-detected as **Next.js** — the defaults are correct
   (Build Command `next build`, Output `.next`, Install `npm install`).
4. Click **Deploy**.

No environment variables are required — the site is fully static content with no
backend, database, or secrets.

## Project structure

```
website/
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx        # fonts (next/font), metadata, skip link
│  │  ├─ page.tsx          # composes the sections in order
│  │  ├─ globals.css       # faithful port of the design tokens + styles
│  │  ├─ not-found.tsx     # themed 404
│  │  ├─ sitemap.ts        # /sitemap.xml
│  │  ├─ robots.ts         # /robots.txt
│  │  └─ icon.svg          # favicon
│  ├─ components/
│  │  ├─ effects/          # NoiseOverlay, DotGrid, Glow, AnimatedCounter
│  │  ├─ sections/         # Navbar, Hero, Trust, Features, Demo, UiShowcase,
│  │  │                    #   Compare, Privacy, Install, Cta, Footer
│  │  └─ common/           # CopyButton
│  └─ lib/                 # constants, demo data, highlight helper
├─ next.config.ts          # security headers, React strict mode
├─ postcss.config.mjs      # Tailwind v4 plugin
└─ tsconfig.json           # strict, @/* alias
```

Client components (`"use client"`) are limited to the leaves that need
interactivity: the interactive **Demo**, the **AnimatedCounter**s in the trust
band, and the **CopyButton**s. Everything else is a React Server Component.
