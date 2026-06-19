interface PrivacyItem {
  icon: string;
  title: string;
  body: React.ReactNode;
}

const ITEMS: PrivacyItem[] = [
  {
    icon: "⦿",
    title: "100% local. No network. Ever.",
    body: "No sync, no telemetry, no cloud. Everything lives in one directory on your machine.",
  },
  {
    icon: "✦",
    title: "Secrets redacted before storage",
    body: (
      <>
        API keys, tokens, and <span className="mono">KEY=value</span> secrets
        are masked on the write path — they never hit the database.
      </>
    ),
  },
  {
    icon: "⊘",
    title: "Exclude & pause",
    body: (
      <>
        Skip sensitive dirs/commands via config, or{" "}
        <span className="mono">bsc pause</span> anytime. You&apos;re in control.
      </>
    ),
  },
  {
    icon: "⚿",
    title: "Owner-only store",
    body: (
      <>
        The data dir is created <span className="mono">0700</span>, the web UI
        is loopback-only and token-gated, and it never executes a command for
        you.
      </>
    ),
  },
];

export function Privacy() {
  return (
    <section>
      <div className="wrap">
        <div className="sec-head">
          <div className="sec-label">Privacy</div>
          <h2>Recording your terminal, without the risk.</h2>
        </div>
        <div className="priv">
          {ITEMS.map((item, i) => (
            <article className="card" key={i}>
              <div className="ico" aria-hidden="true">
                {item.icon}
              </div>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
