import type { ChildProcess } from "node:child_process";
import { terminateProcessTree } from "../../../processes/processTree.js";

/** Provider helpers have no reason to leave descendants behind after cancellation. */
export function terminateProviderProcessTree(child: ChildProcess): Promise<void> {
  return terminateProcessTree(child, { label: "provider helper" });
}
