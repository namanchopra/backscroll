import { GITHUB_URL } from "@/lib/constants";

export function Footer() {
  return (
    <footer>
      <div className="wrap foot-in">
        <a className="brand" href="#top">
          <span className="rec" aria-hidden="true" />
          backscroll
        </a>
        <span className="grow" />
        <span>MIT</span>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <span className="mono">npm i -g backscroll-cli</span>
      </div>
    </footer>
  );
}
