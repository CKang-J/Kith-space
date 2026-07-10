import { randomUUID } from "node:crypto";
import path from "node:path";
import { dbFor, registerWorkspace, schema, type WorkspaceDb } from "../../src/db/index.ts";
import { kithSpaceHome } from "../../src/paths.ts";

export interface IntegrationDatabase {
  db: WorkspaceDb;
  serverId: string;
  rootPath: string;
  schema: typeof schema;
}

/** Register one isolated workspace DB for a standalone integration-test process. */
export function integrationDatabase(name: string): IntegrationDatabase {
  const serverId = randomUUID();
  const rootPath = path.join(kithSpaceHome(), "test-workspaces", serverId);
  registerWorkspace({ id: serverId, name, rootPath });
  return { db: dbFor(serverId), serverId, rootPath, schema };
}
