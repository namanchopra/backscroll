import { GITHUB_URL } from "@/lib/constants";

export function Navbar() {
  return (
    <nav>
      <div className="wrap nav-in">
        <a className="brand" href="#top">
          <span className="rec" aria-hidden="true" />
          backscroll
        </a>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#demo">Demo</a>
          <a href="#install">Install</a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
        <a className="btn amber" href="#install">
          Get started
        </a>
      </div>
    </nav>
  );
}
