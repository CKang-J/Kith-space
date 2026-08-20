/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/rcb/scene/document/pathScale.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/** Tokenize SVG path `d` into commands and numbers. */
function tokenizePath(d: string): string[] {
  return d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
}

const CMD_ARGS: Record<string, number> = {
  M: 2,
  m: 2,
  L: 2,
  l: 2,
  H: 1,
  h: 1,
  V: 1,
  v: 1,
  C: 6,
  c: 6,
  S: 4,
  s: 4,
  Q: 4,
  q: 4,
  T: 2,
  t: 2,
  A: 7,
  a: 7,
};

/**
 * Scale path coordinates from one local box to another (non-uniform ok).
 * Used when resizing merged / custom path shapes.
 */
export function scalePathData(d: string, sx: number, sy: number): string {
  const tokens = tokenizePath(String(d || ''));
  if (!tokens.length) return d;

  const out: string[] = [];
  let i = 0;

  const readNum = () => {
    if (i >= tokens.length) return null;
    const t = tokens[i];
    if (/^[a-zA-Z]$/.test(t)) return null;
    i += 1;
    return parseFloat(t);
  };

  while (i < tokens.length) {
    const cmd = tokens[i++];
    out.push(cmd);

    if (cmd === 'Z' || cmd === 'z') continue;

    const argCount = CMD_ARGS[cmd];
    if (!argCount) continue;

    if (cmd === 'H' || cmd === 'h') {
      let x = readNum();
      while (x != null) {
        out.push(String(Number((x * sx).toFixed(3))));
        x = readNum();
      }
      continue;
    }

    if (cmd === 'V' || cmd === 'v') {
      let y = readNum();
      while (y != null) {
        out.push(String(Number((y * sy).toFixed(3))));
        y = readNum();
      }
      continue;
    }

    if (cmd === 'A' || cmd === 'a') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        const rx = readNum();
        const ry = readNum();
        const rot = readNum();
        const laf = readNum();
        const sf = readNum();
        const x = readNum();
        const y = readNum();
        if (rx == null || ry == null || rot == null || laf == null || sf == null || x == null || y == null) {
          break;
        }
        out.push(
          String(Number((rx * sx).toFixed(3))),
          String(Number((ry * sy).toFixed(3))),
          String(rot),
          String(laf),
          String(sf),
          String(Number((x * sx).toFixed(3))),
          String(Number((y * sy).toFixed(3)))
        );
      }
      continue;
    }

    while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
      const x = readNum();
      const y = readNum();
      if (x == null || y == null) break;
      out.push(String(Number((x * sx).toFixed(3))), String(Number((y * sy).toFixed(3))));
    }
  }

  return out.join(' ');
}

export function isCustomPathShape(shapeType: string) {
  return shapeType === 'path' || shapeType === 'pen' || shapeType === 'pencil';
}
