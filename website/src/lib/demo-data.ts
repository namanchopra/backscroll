export interface DemoCommand {
  /** The command text. */
  c: string;
  /** Working directory it ran in. */
  w: string;
  /** Whether it exited successfully. */
  ok: boolean;
  /** Relative time label. */
  t: string;
  /** Captured stdout/stderr output. */
  o: string;
}

/** Sample command history powering the interactive "Try it" demo. */
export const DEMO_DATA: DemoCommand[] = [
  {
    c: "docker run --rm -p 8080:80 nginx:alpine",
    w: "~/work/api",
    ok: true,
    t: "2m",
    o: "Status: Downloaded newer image for nginx:alpine\n2024/06/19 14:22:07 [notice] 1#1: start worker processes\nServer started on :80 — listening on 0.0.0.0:8080 ✓",
  },
  {
    c: "docker compose up -d --build",
    w: "~/work/api",
    ok: true,
    t: "3w",
    o: "[+] Building 24.1s (12/12) FINISHED\n ✔ Container api-db-1   Started\n ✔ Container api-web-1  Started",
  },
  {
    c: "docker run -d pg:14",
    w: "~/work/api",
    ok: false,
    t: "4w",
    o: "docker: Error response from daemon: port 5432 already allocated.",
  },
  {
    c: "npm run build",
    w: "~/work/web",
    ok: false,
    t: "8m",
    o: "> vite build\n✗ Build failed: Cannot find module './theme' (src/app.tsx:3)",
  },
  {
    c: "git push origin main",
    w: "~/work/api",
    ok: true,
    t: "23m",
    o: "Enumerating objects: 18, done.\nTo github.com:you/api.git\n   a9fc2c8..2ff5c36  main -> main",
  },
  {
    c: "kubectl rollout restart deploy/api",
    w: "~/infra",
    ok: true,
    t: "1d",
    o: "deployment.apps/api restarted",
  },
  {
    c: "ffmpeg -i raw.mov -vcodec h264 out.mp4",
    w: "~/media",
    ok: true,
    t: "3w",
    o: "frame= 1820 fps=240 q=28.0 Lsize=  8123kB\nvideo:8001kB  muxing overhead 1.5%",
  },
  {
    c: "aws s3 sync ./dist s3://site --delete",
    w: "~/work/web",
    ok: true,
    t: "2d",
    o: "upload: dist/index.html to s3://site/index.html\nupload: dist/assets/app.js to s3://site/...",
  },
];
