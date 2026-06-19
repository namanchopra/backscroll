import { CopyButton } from "@/components/common/copy-button";
import { INSTALL_CMD } from "@/lib/constants";

const STEP2_CMD = `echo 'eval "$(bsc init zsh --auto-record)"' >> ~/.zshrc`;
const STEP3_COPY = `bsc search "the thing that worked"`;

export function Install() {
  return (
    <section id="install">
      <div className="wrap">
        <div className="sec-head">
          <div className="sec-label">Get started</div>
          <h2>Three lines to a searchable terminal.</h2>
          <p className="sec-sub">Requires Node 20+ and zsh, on macOS or Linux.</p>
        </div>
        <div className="steps">
          <div className="step">
            <div className="num" aria-hidden="true">
              1
            </div>
            <div className="body">
              <h4>Install</h4>
              <div className="codeline">
                <span className="dollar">$</span>
                <span className="cmd">{INSTALL_CMD}</span>
                <CopyButton value={INSTALL_CMD} label="Copy install command" />
              </div>
            </div>
          </div>

          <div className="step">
            <div className="num" aria-hidden="true">
              2
            </div>
            <div className="body">
              <h4>Turn on recording (commands + output)</h4>
              <div className="codeline">
                <span className="dollar">$</span>
                <span className="cmd">{STEP2_CMD}</span>
                <CopyButton
                  value={STEP2_CMD}
                  label="Copy recording setup command"
                />
              </div>
            </div>
          </div>

          <div className="step">
            <div className="num" aria-hidden="true">
              3
            </div>
            <div className="body">
              <h4>Search your past — or browse it</h4>
              <div className="codeline">
                <span className="cmd">
                  <span className="dollar">$</span> bsc search &quot;the thing
                  that worked&quot; · bsc ui
                </span>
                <CopyButton value={STEP3_COPY} label="Copy search command" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
