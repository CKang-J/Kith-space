import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shouldUpdateChannelResponseMode } from "../web/src/views/chat-message/agentMessageCardModel.ts";
import type { ChannelAgentResponseMode } from "../web/src/views/agent-response-mode/responseModeModel.ts";

const chatSrc = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
const cardSrc = fs.readFileSync(new URL("../web/src/views/chat-message/AgentMessageCard.tsx", import.meta.url), "utf8");
const frameSrc = fs.readFileSync(new URL("../web/src/views/chat-message/MessageIdentityCardFrame.tsx", import.meta.url), "utf8");
const defaultModeCardSrc = fs.readFileSync(new URL("../web/src/views/agent-response-mode/AgentDefaultResponseModeCard.tsx", import.meta.url), "utf8");
const aggregateSrc = fs.readFileSync(new URL("../web/src/views/conversation-aggregate/ConversationAggregatePanel.tsx", import.meta.url), "utf8");
const slidingControlSrc = fs.readFileSync(new URL("../web/src/components/SlidingTabs.tsx", import.meta.url), "utf8");
const slidingControlCss = fs.readFileSync(new URL("../web/src/components/SlidingTabs.css", import.meta.url), "utf8");
const messageCss = fs.readFileSync(new URL("../web/src/views/chat-message/chatMessage.css", import.meta.url), "utf8");
const responseHookSrc = fs.readFileSync(new URL("../web/src/views/agent-response-mode/useChannelAgentResponseModes.ts", import.meta.url), "utf8");
const zh = JSON.parse(fs.readFileSync(new URL("../web/src/locales/zh.json", import.meta.url), "utf8"));

function ruleBody(selector: string, source = messageCss): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1]!;
}

test("agent avatars open a click card without hover-triggered profile state", () => {
  assert.match(chatSrc, /<AgentMessageCard/);
  assert.match(chatSrc, /onClick=\{\(event\) => openMessageAgentCard/);
  assert.match(chatSrc, /aria-haspopup="dialog"/);
  assert.doesNotMatch(chatSrc, /hoverAgent|setHoverAgent|onMouseEnter=.*Agent/);
  assert.doesNotMatch(chatSrc, /ChannelAgentResponseModeBadge|responseModeBadge/);
});

test("the card changes only the current channel override", () => {
  assert.match(cardSrc, /channelCardTitle/);
  assert.match(cardSrc, /CHANNEL_MODE_ORDER: AgentResponseMode\[\] = \["silent", "mention_only", "active"\]/);
  assert.match(cardSrc, /onChangeChannelMode\(mode\)/);
  assert.match(cardSrc, /onChangeChannelMode\(null\)/);
  assert.match(cardSrc, /shouldUpdateChannelResponseMode\(member, mode\)/);
  assert.doesNotMatch(cardSrc, /member\.effectiveResponseMode === mode\) return/);
  assert.match(cardSrc, /member\.responseModeOverride !== null/);
  assert.doesNotMatch(cardSrc, /onChangeDefault|setDefaultResponseMode|\/api\/agents/);
  assert.doesNotMatch(responseHookSrc, /setDefaultResponseMode/);
  assert.equal(zh.responseMode.channelCardTitle, "本频道响应模式");
  assert.match(zh.responseMode.channelOverrideSummary, /仅作用于本频道/);
});

test("selecting the inherited effective mode still creates an explicit channel override", () => {
  const inherited: ChannelAgentResponseMode = {
    agentId: "agent-1",
    defaultResponseMode: "active",
    responseModeOverride: null,
    effectiveResponseMode: "active",
    responseModeSource: "agent_default",
  };
  assert.equal(shouldUpdateChannelResponseMode(inherited, "active"), true);
  assert.equal(shouldUpdateChannelResponseMode({
    ...inherited,
    responseModeOverride: "active",
    responseModeSource: "channel_override",
  }, "active"), false);
});

test("the card keeps only the requested message action", () => {
  assert.match(cardSrc, /<MessageCircle/);
  assert.match(cardSrc, /chat\.messageAgent/);
  assert.doesNotMatch(cardSrc, /悄悄话|分享|Share|Whisper/);
  assert.match(chatSrc, /openAgentDM\(agentId\)/);
});

test("the agent card uses a compact anchored popover and segmented control", () => {
  const card = ruleBody(".message-identity-card");
  const agentCard = ruleBody(".agent-message-card");
  assert.match(card, /position\s*:\s*fixed/);
  assert.match(agentCard, /width\s*:\s*min\(288px,calc\(100vw - 16px\)\)/);
  assert.match(card, /border-radius\s*:\s*18px/);
  assert.match(cardSrc, /<SlidingSegmentedControl<AgentResponseMode>/);
  assert.match(cardSrc, /size="compact"/);
  assert.match(cardSrc, /<MessageIdentityCardFrame/);
  assert.match(frameSrc, /role="dialog"/);
});

test("shared sliding control owns the card and aggregate panel selection visuals", () => {
  assert.match(cardSrc, /SlidingSegmentedControl/);
  assert.match(defaultModeCardSrc, /SlidingSegmentedControl/);
  assert.match(aggregateSrc, /SlidingTabs/);
  assert.match(slidingControlSrc, /semantics === "tabs" \? "tablist" : "radiogroup"/);
  assert.match(slidingControlSrc, /role: "radio" as const/);
  const track = ruleBody(".sliding-tabs", slidingControlCss);
  assert.match(track, /background\s*:\s*var\(--ui-muted-bg\)/);
  const indicator = ruleBody(".sliding-tabs__indicator", slidingControlCss);
  assert.match(indicator, /0 1px 2px rgb\(0 0 0 \/ 7%\)/);
  assert.match(indicator, /0 3px 8px rgb\(0 0 0 \/ 6%\)/);
  assert.match(indicator, /transition\s*:\s*transform 240ms cubic-bezier\(\.22, 1, \.36, 1\)/);
  const action = ruleBody(".agent-message-card__actions>button");
  assert.match(action, /background\s*:\s*#f7f7f7/);
  const actionHover = ruleBody(".agent-message-card__actions>button:hover:not(:disabled)");
  assert.match(actionHover, /background\s*:\s*#f0f0f0/);
});

test("the retired message badge and hover-menu files are removed", () => {
  assert.equal(fs.existsSync(new URL("../web/src/views/agent-response-mode/ChannelAgentResponseModeBadge.tsx", import.meta.url)), false);
  assert.equal(fs.existsSync(new URL("../web/src/views/agent-response-mode/ChannelAgentResponseModeMenu.tsx", import.meta.url)), false);
});
