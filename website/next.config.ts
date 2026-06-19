import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import { dirname } from "path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // This app is a standalone project nested in the Backscroll repo (which has
  // its own lockfile for the CLI). Pin the tracing root to this directory so
  // Next.js doesn't infer the wrong workspace root.
  outputFileTracingRoot: projectRoot,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
