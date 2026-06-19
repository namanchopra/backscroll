import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The SPA source lives in this `ui/` directory and builds to `../dist-ui`
// (resolved relative to this file, i.e. repo-root/dist-ui).
// `base: './'` makes generated asset URLs relative so the prebuilt bundle
// can be served from any path.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist-ui',
    emptyOutDir: true,
  },
})
