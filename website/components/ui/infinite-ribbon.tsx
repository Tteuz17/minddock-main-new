const items = Array.from({ length: 12 }, () => "NotebookLM")

export function InfiniteRibbon() {
  return (
    <section className="ribbon-shell" aria-label="NotebookLM ribbon">
      <div className="ribbon-track">
        <div className="ribbon-row">
          {items.map((item, index) => (
            <span key={`a-${index}`} className="ribbon-item">
              {item}
            </span>
          ))}
        </div>

        <div className="ribbon-row" aria-hidden="true">
          {items.map((item, index) => (
            <span key={`b-${index}`} className="ribbon-item">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
