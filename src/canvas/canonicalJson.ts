/** Locale-independent Unicode code-point order. UTF-16 surrogate pairs compare as a single scalar. */
export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftLen = left.length;
  const rightLen = right.length;
  const limit = leftLen < rightLen ? leftLen : rightLen;
  for (let index = 0; index < limit; ) {
    const leftPoint = left.codePointAt(index) ?? 0;
    const rightPoint = right.codePointAt(index) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    index += leftPoint > 0xffff ? 2 : 1;
  }
  return leftLen === rightLen ? 0 : leftLen < rightLen ? -1 : 1;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}
