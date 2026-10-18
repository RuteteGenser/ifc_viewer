import { useState } from "react";

export default function Compass({ angleDeg, offsetDeg, onOffsetChange, disabled }) {
  const handleOffsetChange = (e) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) return;
    onOffsetChange(((value % 360) + 360) % 360);
  };

  // On a narrow screen the offset field is out of the way until the compass is tapped.
  const [showOffset, setShowOffset] = useState(false);

  return (
    <div className={`compass${showOffset ? " compass--open" : ""}`}>
      <button
        type="button"
        className="compass__button"
        aria-label="North offset"
        aria-expanded={showOffset}
        onClick={() => setShowOffset((v) => !v)}
      >
      <span className="compass__dial" style={{ transform: `rotate(${angleDeg}deg)` }}>
        <svg viewBox="0 0 48 48" width="48" height="48">
          <line x1="24" y1="6" x2="24" y2="10" stroke="#c9bfa8" strokeWidth="1" transform="rotate(91 24 24)" />
          <line x1="24" y1="6" x2="24" y2="10" stroke="#c9bfa8" strokeWidth="1" transform="rotate(181.5 24 24)" />
          <line x1="24" y1="6" x2="24" y2="10" stroke="#c9bfa8" strokeWidth="1" transform="rotate(269 24 24)" />
          <path d="M24 12 L29 26 L24 22.5 L19 26 Z" fill="#2a2622" />
          <path d="M24 42 L29 26 L24 29.5 L19 26 Z" fill="#c9bfa8" />
          <text x="24" y="8" textAnchor="middle" fontSize="8" fontWeight="700" fill="#2a2622">
            N
          </text>
        </svg>
      </span>
      </button>
      {/* A div, not a label: tapping the words next to the field must not pop up a keyboard. */}
      <div className="compass__offset" title="Correct the model's true north without rotating it">
        <span>N offset</span>
        <input
          type="number"
          aria-label="North offset in degrees"
          min={0}
          max={359}
          step={1}
          value={Math.round(offsetDeg)}
          onChange={handleOffsetChange}
          disabled={disabled}
        />
        <span>°</span>
      </div>
    </div>
  );
}
