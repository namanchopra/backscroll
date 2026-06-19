interface Feature {
  icon: string;
  title: React.ReactNode;
  body: React.ReactNode;
}

const FEATURES: Feature[] = [
  {
    icon: "▦",
    title: "Captures the output",
    body: "A PTY wrapper records each command's full stdout/stderr, exit code, cwd, branch, and duration — not just the command text.",
  },
  {
    icon: "⌕",
    title: <>Search commands &amp; output</>,
    body: "Full-text search (SQLite + FTS5) across everything. Filter by directory, success-only, or a time range like “since 3w”.",
  },
  {
    icon: "●",
    title: "Always-on recording",
    body: (
      <>
        One line in your <span className="mono">.zshrc</span> and every shell
        records automatically. No <span className="mono">bsc rec</span>, no
        thinking about it.
      </>
    ),
  },
  {
    icon: "▣",
    title: "Local web UI",
    body: (
      <>
        <span className="mono">bsc ui</span> opens a private, loopback-only
        browser app — a timeline of your history with a live output viewer.
      </>
    ),
  },
  {
    icon: "⛨",
    title: "Private by default",
    body: "Secrets are redacted before they're ever stored. Exclude dirs/commands, pause anytime. Nothing leaves your machine.",
  },
  {
    icon: "↻",
    title: "Bring your past",
    body: (
      <>
        <span className="mono">bsc import</span> backfills your existing{" "}
        <span className="mono">~/.zsh_history</span> so years of commands are
        searchable on day one.
      </>
    ),
  },
];

export function Features() {
  return (
    <section id="features">
      <div className="wrap">
        <div className="sec-head">
          <div className="sec-label">What it does</div>
          <h2>Your terminal history, finally searchable — output and all.</h2>
          <p className="sec-sub">
            Atuin remembers the commands. Backscroll also remembers what they
            printed.
          </p>
        </div>
        <div className="features">
          {FEATURES.map((f, i) => (
            <article className="card" key={i}>
              <div className="ico" aria-hidden="true">
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
