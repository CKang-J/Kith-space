import assert from "node:assert/strict";
import { initializeHumanProfile } from "../../src/app-data/appDatabase.ts";
import { closeAllDatabases } from "../../src/db/index.ts";
import { localHumanForSubject } from "../../src/human/humanAuthority.ts";
import { getHumanIdentity, humanIdentityForHandle, humanIdentityForId } from "../../src/human/humanIdentity.ts";

const root = process.env.KITH_SPACE_HUMAN_AUTHORITY_CASE_ROOT;
assert.ok(root, "KITH_SPACE_HUMAN_AUTHORITY_CASE_ROOT is required");

try {
  const human = initializeHumanProfile({ id: "human-1", name: "Ada" });
  assert.deepEqual(localHumanForSubject(human.id), human);
  assert.equal(localHumanForSubject("someone-else"), null);
  assert.equal(localHumanForSubject(null), null);
  assert.deepEqual(getHumanIdentity(), {
    id: human.id,
    handle: "you",
    displayName: "Ada",
    email: null,
    description: null,
  });
  assert.equal(humanIdentityForId("someone-else"), null);
  assert.equal(humanIdentityForHandle("@YOU")?.id, human.id);
  assert.equal(humanIdentityForHandle("Ada"), null);
} finally {
  closeAllDatabases();
}
