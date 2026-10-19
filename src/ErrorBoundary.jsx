import { Component, useState } from "react";
import { formatCrashDetails } from "./reliability/crashDetails";
import { runningBuildId } from "./reliability/recovery";

// A render crash shows this plain screen instead of a white page. Handled async errors
// (promises, event handlers) never reach an error boundary, so they are unaffected.
// Nothing is sent anywhere: the details only go to the clipboard if the person copies them.
const S = {
  wrap: { minHeight: "100%", display: "grid", placeItems: "center", padding: 16, background: "var(--bg, #fbfaf6)", color: "var(--text, #2a2622)", fontFamily: "var(--font-sans, system-ui, sans-serif)" },
  card: { maxWidth: 520, width: "100%", display: "grid", gap: 16 },
  h: { margin: 0, fontFamily: "var(--font-serif, Georgia, serif)", fontSize: 24 },
  p: { margin: 0, color: "var(--text-muted, #6b6155)", lineHeight: 1.5 },
  btn: { minHeight: 44, minWidth: 44, padding: "0 20px", font: "inherit", fontWeight: 600, border: 0, borderRadius: 6, background: "var(--accent, #96652f)", color: "#fff", cursor: "pointer", justifySelf: "start" },
  summary: { minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer", color: "var(--text-muted, #6b6155)" },
  pre: { margin: 0, padding: 12, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, background: "var(--bg-subtle, #f3efe4)", border: "1px solid var(--border, #ddd6c7)", borderRadius: 6 },
};

function CrashScreen({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard blocked: the text is selectable above */
    }
  };
  return (
    <div style={S.wrap} role="alert" data-testid="crash-screen">
      <div style={S.card}>
        <h1 style={S.h}>Something went wrong</h1>
        <p style={S.p}>The viewer hit an unexpected error. Reloading usually fixes it.</p>
        <button type="button" style={S.btn} onClick={() => window.location.reload()}>
          Reload
        </button>
        <details>
          <summary style={S.summary}>Details</summary>
          <pre style={S.pre} tabIndex={0} aria-label="Error details">{text}</pre>
          <button type="button" style={{ ...S.btn, background: "transparent", color: "var(--accent, #96652f)", border: "1px solid var(--accent, #96652f)", marginTop: 8 }} onClick={copy}>
            {copied ? "Copied" : "Copy details"}
          </button>
        </details>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component {
  state = { error: null, componentStack: "" };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    this.setState({ componentStack: info?.componentStack || "" });
    console.error("The viewer crashed while rendering", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const text = formatCrashDetails({
      error: this.state.error,
      componentStack: this.state.componentStack,
      buildId: runningBuildId(),
      userAgent: navigator.userAgent,
    });
    return <CrashScreen text={text} />;
  }
}

// Test builds only (VITE_TEST_HOOK): ?__crash=1 forces a render crash.
export function CrashProbe() {
  if (import.meta.env.VITE_TEST_HOOK && new URLSearchParams(window.location.search).get("__crash") === "1") {
    throw new Error("forced crash (?__crash=1)");
  }
  return null;
}
