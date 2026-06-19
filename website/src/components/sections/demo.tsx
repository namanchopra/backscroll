"use client";

import { useMemo, useState } from "react";
import { DEMO_DATA } from "@/lib/demo-data";
import { highlight } from "@/lib/highlight";

export function Demo() {
  const [query, setQuery] = useState("docker");
  const [sel, setSel] = useState(0);

  const term = query.trim();

  // Filter on command OR output text (case-insensitive substring match) —
  // exactly the mockup's filter predicate.
  const view = useMemo(() => {
    const lower = term.toLowerCase();
    return DEMO_DATA.filter(
      (d) =>
        !lower ||
        d.c.toLowerCase().includes(lower) ||
        d.o.toLowerCase().includes(lower),
    );
  }, [term]);

  // Clamp selection into range whenever the view shrinks.
  const safeSel = sel >= view.length ? 0 : sel;
  const selected = view[safeSel];

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setSel(0);
  }

  return (
    <section id="demo">
      <div className="wrap">
        <div className="sec-head">
          <div className="sec-label">Try it</div>
          <h2>Find the one that worked.</h2>
          <p className="sec-sub">
            A live taste of search — type below, pick a result, read what it
            printed. (Sample data.)
          </p>
        </div>

        <div className="demo">
          <div className="demo-panel">
            <div className="demo-search">
              <span className="glyph" aria-hidden="true">
                ⌕
              </span>
              <input
                id="q"
                value={query}
                onChange={onChange}
                aria-label="Search the sample command history"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="demo-list" role="listbox" aria-label="Results">
              {view.length === 0 ? (
                <div className="demo-empty">No matches.</div>
              ) : (
                view.map((d, i) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === safeSel}
                    className={`drow${i === safeSel ? " sel" : ""}`}
                    key={`${d.c}-${i}`}
                    onClick={() => setSel(i)}
                  >
                    <span
                      className={`dot${d.ok ? "" : " bad"}`}
                      aria-hidden="true"
                    />
                    <span className="c">{highlight(d.c, term)}</span>
                    <span className="w">{d.t}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="term" id="demoTerm">
            <div className="term-bar">
              <span className="lights" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="ttl">
                {selected ? (
                  <>
                    stdout · stderr — exit{" "}
                    <span style={{ color: selected.ok ? "var(--ok)" : "var(--bad)" }}>
                      {selected.ok ? 0 : 1}
                    </span>
                  </>
                ) : (
                  "output"
                )}
              </span>
            </div>
            <div className="term-body" id="demoOut" aria-live="polite">
              {selected && (
                <>
                  <span className="p">❯</span> {highlight(selected.c, term)}
                  {"\n"}
                  {selected.ok ? (
                    highlight(selected.o, term)
                  ) : (
                    <span className="r">{highlight(selected.o, term)}</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
