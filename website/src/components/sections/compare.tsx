export function Compare() {
  return (
    <section>
      <div className="wrap">
        <div className="sec-head">
          <div className="sec-label">How it&apos;s different</div>
          <h2>Backscroll vs. atuin</h2>
        </div>
        <div className="compare">
          <div className="card">
            <h3>
              <span className="tag them">atuin</span> Command history
            </h3>
            <ul>
              <li>Records the commands you typed</li>
              <li>Syncs history across machines</li>
              <li>Great fuzzy history search</li>
              <li>Doesn&apos;t capture output</li>
            </ul>
          </div>
          <div className="card" style={{ borderColor: "var(--amber-dim)" }}>
            <h3>
              <span className="tag us">backscroll</span> Commands + output
            </h3>
            <ul>
              <li>
                Records commands <b>and their output</b>
              </li>
              <li>Find results by what they printed</li>
              <li>100% local — no sync, no network</li>
              <li>Local web UI + timeline</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
