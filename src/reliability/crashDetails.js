// Plain-text details for the crash screen (what a person pastes into a bug report).
export function formatCrashDetails({ error, componentStack = "", buildId = null, userAgent = "" }) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error ?? "Unknown error");
  const parts = [
    `Error: ${message || "(no message)"}`,
    `Build: ${buildId || "unknown"}`,
    `User agent: ${userAgent || "unknown"}`,
  ];
  const stack = String(componentStack || "").replace(/^\n+/, "").trimEnd();
  if (stack) parts.push("Component stack:", stack);
  return parts.join("\n");
}
