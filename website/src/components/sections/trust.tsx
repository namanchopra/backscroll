import { AnimatedCounter } from "@/components/effects/animated-counter";

export function Trust() {
  return (
    <div className="trust">
      <div className="stat">
        <div className="n">
          <AnimatedCounter to={100} suffix="%" />
        </div>
        <div className="l">local — on your machine</div>
      </div>
      <div className="stat">
        <div className="n">
          <AnimatedCounter to={0} />
        </div>
        <div className="l">network calls, ever</div>
      </div>
      <div className="stat">
        <div className="n">cmd + out</div>
        <div className="l">every command &amp; its output</div>
      </div>
      <div className="stat">
        <div className="n">FTS5</div>
        <div className="l">SQLite full-text search</div>
      </div>
    </div>
  );
}
