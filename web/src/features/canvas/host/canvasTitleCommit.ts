export type CanvasTitleCommit =
  | { kind: "skip" }
  | { kind: "restore"; title: string }
  | { kind: "rename"; title: string };

/**
 * Draft typing may be empty; Core `safeTitle` rejects 0-length names.
 * Keep the input empty while focused, and only restore the durable title on commit.
 */
export function planCanvasTitleCommit(
  phase: unknown,
  draft: string,
  durableTitle: string,
): CanvasTitleCommit {
  const trimmed = draft.trim();
  if (!trimmed) {
    const previous = durableTitle.trim();
    return phase === "commit" && previous
      ? { kind: "restore", title: previous }
      : { kind: "skip" };
  }
  if (trimmed === durableTitle) return { kind: "skip" };
  return { kind: "rename", title: trimmed };
}
