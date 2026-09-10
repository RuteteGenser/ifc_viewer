// Custom hover tooltip so a description and its hotkey can be laid out
// separately (description left-aligned, hotkey right-aligned) — a plain
// `title` attribute can't do that. Purely CSS-driven (:hover/:focus-within),
// no positioning JS needed since every trigger sits in a single top row.
export default function Tooltip({ description, hotkey, children, align = "center" }) {
  return (
    <span className="tooltip">
      {children}
      <span className={`tooltip__box tooltip__box--${align}`} role="tooltip">
        <span className="tooltip__desc">{description}</span>
        {hotkey && <span className="tooltip__hotkey">{hotkey}</span>}
      </span>
    </span>
  );
}
