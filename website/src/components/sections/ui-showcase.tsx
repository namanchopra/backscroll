export function UiShowcase() {
  return (
    <section>
      <div className="wrap">
        <div className="sec-head">
          <div className="sec-label">The web UI</div>
          <h2>Browse a timeline of everything you&apos;ve run.</h2>
          <p className="sec-sub">
            <span className="mono">bsc ui</span> — light/dark, virtualized over
            tens of thousands of commands, output pane, copy &amp; re-run.
            Local-only, token-gated.
          </p>
        </div>

        <div className="shot">
          <div className="shot-top">
            <span className="lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span
              className="ttl mono"
              style={{ color: "var(--faint)", fontSize: "11px" }}
            >
              127.0.0.1 · backscroll
            </span>
          </div>
          <div className="shot-grid">
            <div className="shot-list">
              <div className="shot-glabel">Today</div>
              <div className="shot-row sel">
                <span style={{ color: "var(--ok)" }}>✓</span>
                <span style={{ flex: 1 }}>docker run --rm…</span>
                <span style={{ color: "var(--faint)" }}>2m</span>
              </div>
              <div className="shot-row">
                <span style={{ color: "var(--bad)" }}>✗</span>
                <span style={{ flex: 1 }}>npm run build</span>
                <span style={{ color: "var(--faint)" }}>8m</span>
              </div>
              <div className="shot-row">
                <span style={{ color: "var(--ok)" }}>✓</span>
                <span style={{ flex: 1 }}>git push origin…</span>
                <span style={{ color: "var(--faint)" }}>23m</span>
              </div>
              <div className="shot-glabel">3 weeks ago</div>
              <div className="shot-row">
                <span style={{ color: "var(--faint)" }}>?</span>
                <span style={{ flex: 1 }}>ffmpeg -i raw…</span>
                <span style={{ color: "var(--faint)" }}>3w</span>
              </div>
            </div>
            <div className="shot-detail">
              <div
                className="mono"
                style={{ fontSize: "16px", marginBottom: "12px" }}
              >
                <span style={{ color: "var(--amber)" }}>❯</span> docker run
                --rm -p 8080:80 nginx:alpine
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "7px",
                  flexWrap: "wrap",
                  marginBottom: "14px",
                }}
              >
                <span className="pill" style={{ color: "var(--ok)" }}>
                  exit 0
                </span>
                <span className="pill">~/work/api</span>
                <span className="pill">main</span>
                <span className="pill">1.4s</span>
                <span className="pill">pty</span>
              </div>
              <div className="term">
                <div className="term-bar">
                  <span className="lights" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="ttl">
                    stdout · stderr — exit{" "}
                    <span style={{ color: "var(--ok)" }}>0</span>
                  </span>
                </div>
                <div className="term-body">
                  <span className="dim">
                    Status: Downloaded newer image for nginx:alpine
                  </span>
                  {"\n"}
                  <span className="g">
                    2024/06/19 14:22:07 [notice] 1#1: start worker processes
                  </span>
                  {"\n"}
                  Server started on <span className="p">:80</span> — listening
                  on 0.0.0.0:8080 ✓
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
