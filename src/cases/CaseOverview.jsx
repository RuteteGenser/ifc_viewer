import { useEffect, useMemo, useState } from "react";
import { blobUrl, DISCIPLINES } from "./caseStore";
import { DISCIPLINE_COLORS } from "./disciplines";

function DisciplineBadges({ list }) {
  if (!list?.length) return null;
  return (
    <span className="discipline-badges">
      {list.map((d) => (
        <span key={d} className="discipline-badge" style={{ background: DISCIPLINE_COLORS[d] }}>
          {d}
        </span>
      ))}
    </span>
  );
}

// Full-screen gallery of every photo from every case, filterable by
// discipline, with a lightbox (prev/next) showing the case summary.
export default function CaseOverview({ cases, onShowOnPlan, onEdit }) {
  const [filter, setFilter] = useState("ALL");
  const [openIndex, setOpenIndex] = useState(null);

  const allPhotos = useMemo(
    () =>
      cases
        .flatMap((c) => c.photos.map((photo) => ({ photo, c })))
        .sort((a, b) => b.photo.addedAt - a.photo.addedAt),
    [cases],
  );

  const counts = useMemo(() => {
    const out = { ALL: allPhotos.length };
    for (const d of DISCIPLINES) out[d] = allPhotos.filter(({ c }) => c.disciplines.includes(d)).length;
    return out;
  }, [allPhotos]);

  const shown = useMemo(
    () => (filter === "ALL" ? allPhotos : allPhotos.filter(({ c }) => c.disciplines.includes(filter))),
    [allPhotos, filter],
  );

  const current = openIndex !== null ? shown[openIndex] : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (openIndex !== null) setOpenIndex(null);
      } else if (openIndex !== null && e.key === "ArrowRight") {
        setOpenIndex((i) => Math.min(i + 1, shown.length - 1));
      } else if (openIndex !== null && e.key === "ArrowLeft") {
        setOpenIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, shown.length]);

  return (
    <div className="case-overview">
      <div className="case-overview__bar">
        <div className="case-overview__title">Photo overview</div>
        <div className="case-overview__filters" role="group" aria-label="Filter by discipline">
          {["ALL", ...DISCIPLINES].map((d) => (
            <button
              key={d}
              type="button"
              className={`discipline-chip${filter === d ? " discipline-chip--on" : ""}`}
              style={{ "--chip": d === "ALL" ? "var(--ink)" : DISCIPLINE_COLORS[d] }}
              aria-pressed={filter === d}
              onClick={() => {
                setFilter(d);
                setOpenIndex(null);
              }}
            >
              {d === "ALL" ? "All" : d}
              <span className="discipline-chip__count">{counts[d]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="case-overview__body">
        {shown.length === 0 ? (
          <p className="case-overview__empty">
            {allPhotos.length === 0
              ? "No photos yet. Open the Plans page, tap + Case, then tap a spot on the floor plan to add photos."
              : `No photos tagged ${filter}.`}
          </p>
        ) : (
          <div className="case-overview__grid">
            {shown.map(({ photo, c }, i) => (
              <button type="button" className="case-tile" key={photo.id} onClick={() => setOpenIndex(i)}>
                <img src={blobUrl(photo.thumb)} alt={photo.name} loading="lazy" />
                <span className="case-tile__caption">
                  <span className="case-tile__title">{c.title}</span>
                  <DisciplineBadges list={c.disciplines} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {current && (
        <div
          className="case-lightbox"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpenIndex(null);
          }}
        >
          <button
            type="button"
            className="case-lightbox__nav case-lightbox__nav--prev"
            aria-label="Previous photo"
            disabled={openIndex === 0}
            onClick={() => setOpenIndex((i) => i - 1)}
          >
            ‹
          </button>
          <div className="case-lightbox__content">
            <img className="case-lightbox__img" src={blobUrl(current.photo.blob)} alt={current.photo.name} />
            <div className="case-lightbox__info">
              <div className="case-lightbox__head">
                <strong>{current.c.title}</strong>
                <DisciplineBadges list={current.c.disciplines} />
                <span className="case-lightbox__count">
                  {openIndex + 1} / {shown.length}
                </span>
              </div>
              {current.c.summary && <p className="case-lightbox__summary">{current.c.summary}</p>}
              <div className="case-lightbox__actions">
                <button
                  type="button"
                  className="confirm-dialog__confirm"
                  disabled={!current.c.floor}
                  title="Open this case on its floor plan"
                  onClick={() => onShowOnPlan(current.c)}
                >
                  Show on plan
                </button>
                <button type="button" className="confirm-dialog__cancel" onClick={() => onEdit(current.c)}>
                  Edit case
                </button>
                <button type="button" className="confirm-dialog__cancel" onClick={() => setOpenIndex(null)}>
                  Close photo
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="case-lightbox__nav case-lightbox__nav--next"
            aria-label="Next photo"
            disabled={openIndex === shown.length - 1}
            onClick={() => setOpenIndex((i) => i + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
