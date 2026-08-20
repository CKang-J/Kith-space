import type { TrajGroupItem } from "@/trajBuffer";

export type TrajectoryStep =
  | {
    kind: "item";
    item: TrajGroupItem;
    sourceIndex: number;
  }
  | {
    kind: "tool-group";
    items: Extract<TrajGroupItem, { kind: "tool" }>[];
    sourceIndex: number;
  };

/**
 * Only adjacent tool calls belong to one disclosure. A reasoning, text, or
 * status entry is a semantic boundary and must remain in the original order.
 */
export function groupTrajectorySteps(items: TrajGroupItem[]): TrajectoryStep[] {
  const steps: TrajectoryStep[] = [];

  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    if (item.kind !== "tool") {
      steps.push({ kind: "item", item, sourceIndex: index });
      index += 1;
      continue;
    }

    const tools: Extract<TrajGroupItem, { kind: "tool" }>[] = [];
    let cursor = index;
    while (cursor < items.length && items[cursor]?.kind === "tool") {
      tools.push(items[cursor] as Extract<TrajGroupItem, { kind: "tool" }>);
      cursor += 1;
    }

    if (tools.length === 1) {
      steps.push({ kind: "item", item: tools[0]!, sourceIndex: index });
    } else {
      steps.push({ kind: "tool-group", items: tools, sourceIndex: index });
    }
    index = cursor;
  }

  return steps;
}
