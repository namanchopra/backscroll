/**
 * The two fixed, blurred radial glows behind the page: a large amber halo at
 * the top (`a`) and a smaller violet one to the right (`b`). Decorative.
 */
export function Glow() {
  return (
    <>
      <div className="glow a" aria-hidden="true" />
      <div className="glow b" aria-hidden="true" />
    </>
  );
}
