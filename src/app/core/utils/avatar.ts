/**
 * Small, dependency-free helpers shared by the circle management screens.
 */

const AVATAR_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#6366f1", "#8b5cf6"], // indigo -> violet
  ["#3b82f6", "#06b6d4"], // blue -> cyan
  ["#10b981", "#34d399"], // emerald
  ["#f59e0b", "#fbbf24"], // amber
  ["#f43f5e", "#fb7185"], // rose
  ["#8b5cf6", "#d946ef"], // violet -> fuchsia
  ["#14b8a6", "#2dd4bf"], // teal
  ["#0ea5e9", "#38bdf8"], // sky
];

/** "Weekend Crew" -> "WC", "Alpha" -> "A", "" -> "?". */
export function initialsFor(name: string): string {
  const parts = (name ?? "").trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0].charAt(0);
  const second = parts.length > 1 ? parts[1].charAt(0) : "";
  return (first + second).toUpperCase();
}

/** Stable, pleasant gradient for a name, so avatars feel personal. */
export function avatarGradient(seed: string): string {
  const value = seed ?? "";
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  const [from, to] = AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}
