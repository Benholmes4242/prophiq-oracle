export function LoadingNucleus() {
  return (
    <div className="loading-nucleus" aria-hidden>
      <div className="nucleus-ring nucleus-ring-outer" />
      <div className="nucleus-ring nucleus-ring-inner" />
      <div className="nucleus-orbit nucleus-orbit-outer">
        <div className="nucleus-particle nucleus-particle-outer" />
      </div>
      <div className="nucleus-orbit nucleus-orbit-inner">
        <div className="nucleus-particle nucleus-particle-inner" />
      </div>
      <div className="nucleus-core" />
    </div>
  );
}
