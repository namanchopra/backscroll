import { CopyButton } from "@/components/common/copy-button";
import { Trust } from "@/components/sections/trust";
import { GITHUB_URL, INSTALL_CMD } from "@/lib/constants";

export function Hero() {
  return (
    <header className="hero">
      <div className="wrap">
        <span className="eyebrow">
          <span className="rec" aria-hidden="true" />
          Open source · 100% local · zero network
        </span>
        <h1>
          Scroll back through <span className="hl">everything</span> you&apos;ve
          ever run.
        </h1>
        <p className="sub">
          Backscroll records every shell command <b>and its output</b> into a
          local, searchable store — so &ldquo;what was that command three weeks
          ago that <i>actually worked</i>?&rdquo; is one search away.
        </p>

        <div className="hero-cta">
          <div className="install">
            <span className="dollar">$</span>
            <span className="cmd">{INSTALL_CMD}</span>
            <CopyButton value={INSTALL_CMD} label="Copy install command" />
          </div>
          <a
            className="btn"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub ↗
          </a>
        </div>

        <div className="term hero-term">
          <div className="term-bar">
            <span className="lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="ttl">~/work/api — zsh</span>
          </div>
          <div className="term-body">
            <span className="p">❯</span> bsc search{" "}
            <span className="hl">&quot;docker run&quot;</span> --success --since
            3w{"\n"}
            <span className="dim"> #1421 ✓ 3w ago ~/work/api</span> docker run
            --rm -p 8080:80 nginx:alpine{"\n"}
            <span className="dim"> ↳</span> Server started on{" "}
            <span className="g">:80</span> — listening on 0.0.0.0:8080 ✓{"\n"}
            <span className="dim"> #1402 ✗ 4w ago ~/work/api</span> docker run
            -d pg:14{"\n"}
            <span className="dim"> ↳</span>{" "}
            <span className="r">Error: port 5432 already allocated</span>
            {"\n"}
            <span className="p">❯</span> <span className="caret">▏</span>
          </div>
        </div>

        <Trust />
      </div>
    </header>
  );
}
