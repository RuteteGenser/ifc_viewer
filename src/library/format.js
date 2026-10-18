export function formatSize(bytes) {
  const mb = (bytes || 0) / (1024 * 1024);
  if (mb < 0.1) return "<0.1 MB";
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const UNITS = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeDate(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 60) return "just now";
  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}
