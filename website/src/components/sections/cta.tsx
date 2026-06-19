import { CopyButton } from "@/components/common/copy-button";
import { GITHUB_URL, INSTALL_CMD } from "@/lib/constants";

export function Cta() {
  return (
    <section id="gh">
      <div className="wrap">
        <div className="cta">
          <span className="eyebrow">
            <span className="rec" aria-hidden="true" />
            MIT · open source
          </span>
          <h2 style={{ maxWidth: "22ch" }}>
            Stop losing the command that worked.
          </h2>
          <p className="sec-sub">
            Install it in 30 seconds. Your terminal remembers the rest.
          </p>
          <div className="hero-cta">
            <div className="install">
              <span className="dollar">$</span>
              <span className="cmd">{INSTALL_CMD}</span>
              <CopyButton value={INSTALL_CMD} label="Copy install command" />
            </div>
            <a
              className="btn amber"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Star on GitHub ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
