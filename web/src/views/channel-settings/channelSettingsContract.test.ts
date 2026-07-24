import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("channel settings keeps panel navigation separate from layout ownership", () => {
  const panel = source("./ChannelSettingsPanel.tsx");
  const types = source("./types.ts");

  assert.match(types, /onBackToContent\(\): void/);
  assert.match(types, /onClose\(\): void/);
  assert.match(types, /onDirtyChange\?\(dirty: boolean\): void/);
  assert.match(panel, /if \(page === "index"\) onBackToContent\(\)/);
  assert.match(panel, /setPage\("index"\)/);
  assert.match(panel, /\[channel\.id, loadMembers, loadNotification\]/);
  assert.doesNotMatch(`${panel}\n${types}`, /WorkspaceFrame|paneWidth|aggregateWidth|useNavigate/);
});

test("required and archived channels expose only the allowed settings actions", () => {
  const general = source("./ChannelGeneralSettings.tsx");
  const index = source("./ChannelSettingsIndex.tsx");
  const dialog = source("./ChannelDeleteDialog.tsx");

  assert.match(general, /disabled=\{readOnly \|\| required\}/);
  assert.match(general, /required\s*\? \{ description: normalized\.description \}/);
  assert.match(index, /disabled=\{required \|\| busy !== null\}/);
  assert.match(index, /channelSettings\.requiredDeleteDescription/);
  assert.match(index, /\/archive`/);
  assert.match(index, /\/unarchive`/);
  assert.match(dialog, /matchesDeleteConfirmation\(confirmation, channelName\)/);
  assert.match(dialog, /AlertDialogContent/);
  assert.match(dialog, /AlertDialogCancel/);
  assert.match(dialog, /FieldGroup/);
  assert.match(dialog, /<Input/);
  assert.match(dialog, /onOpenAutoFocus/);
  assert.match(dialog, /confirmationInputRef\.current\?\.focus\(\)/);
  assert.match(dialog, /overlayProps=\{\{ onClick: close \}\}/);
  assert.match(dialog, /if \(busy\) event\.preventDefault\(\)/);
  assert.match(dialog, /data-\[size=default\]:sm:max-w-none/);
  assert.match(dialog, /bg-\[var\(--error\)\]/);
  assert.doesNotMatch(dialog, /createPortal|useEscClose/);
});

test("member and notification pages use the agreed channel-scoped API contracts", () => {
  const members = source("./ChannelMemberSettings.tsx");
  const addMemberDialog = source("./ChannelAddMemberDialog.tsx");
  const notifications = source("./ChannelNotificationSettings.tsx");

  assert.match(members, /`\/api\/channels\/\$\{encodeURIComponent\(channelId\)\}\/members`/);
  assert.match(members, /\{ agentId: agent\.id \}/);
  assert.match(members, /channelSettings\.members\.administrator/);
  assert.match(members, /human\?\.name/);
  assert.match(members, /removeConfirmTitle/);
  assert.match(members, /<ChannelAddMemberDialog/);
  assert.match(addMemberDialog, /role="dialog"/);
  assert.match(addMemberDialog, /role="radiogroup"/);
  assert.match(notifications, /"PATCH", `\/api\/channels\/\$\{encodeURIComponent\(channelId\)\}\/notification`/);
  assert.match(notifications, /notificationLevel: next/);
});
