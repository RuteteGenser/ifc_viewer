import { useEffect } from "react";
import Tooltip from "./Tooltip";
import { announcePopover } from "../hooks/usePopoverGroup";

function ClipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 15 L20 9" />
    </svg>
  );
}

export default function CameraClipControl({
  cameraClipEnabled,
  onSetCameraClipEnabled,
  disabled,
  onBlocked,
}) {
  // Esc closes the tool, like the other armed tools.
  useEffect(() => {
    if (!cameraClipEnabled) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && !e.ifcEscHandled) onSetCameraClipEnabled(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameraClipEnabled, onSetCameraClipEnabled]);
  return (
    <div className="camera-clip">
      <Tooltip description={disabled ? "Open a model first" : "Clip in front of the camera"}>
        <button
          type="button"
          className={`top-bar__icon-button${cameraClipEnabled ? " top-bar__icon-button--active" : ""}${disabled ? " is-blocked" : ""}`}
          onClick={() => {
            if (disabled) onBlocked?.();
            else {
              if (!cameraClipEnabled) announcePopover("camera-clip");
              onSetCameraClipEnabled(!cameraClipEnabled);
            }
          }}
          aria-disabled={disabled}
          aria-label="Toggle camera clip"
        >
          <ClipIcon />
          <span className="top-bar__caption" aria-hidden="true">Clip</span>
        </button>
      </Tooltip>
    </div>
  );
}

// The distance slider, shown in the tool column (Hud) while the clip is on.
export function CameraClipPanel({ enabled, distance, max, onChange, onDone }) {
  if (!enabled) return null;
  return (
    <div className="camera-clip-popover" role="group" aria-label="Camera clip">
      <div className="camera-clip-popover__head">
        <span>Camera clip</span>
        <button type="button" className="tool-hint__done camera-clip-popover__done" onClick={onDone}>
          Done
        </button>
      </div>
      <input
        type="range"
        className="clip-control__slider"
        aria-label="Camera clip distance"
        min="0"
        max={max}
        step="any"
        value={distance}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="clip-control__hint">
        Distance from camera to the cut plane.
      </p>
    </div>
  );
}
