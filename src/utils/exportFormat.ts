/** Formats a clip length in seconds as MM:SS. */
export function formatClipDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";

  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

/** Formats an export's createdAt as a short local date/time. */
export function formatExportDate(iso: string): string {
  // Legacy rows use SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC.
  const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A clip shows its own name once renamed, otherwise the given fallback. */
export function clipDisplayName(
  clip: { name: string | null },
  fallback: string,
): string {
  return clip.name?.trim() || fallback;
}
