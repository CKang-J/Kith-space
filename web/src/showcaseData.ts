// Static showcase data — four read-only collaboration sessions rendered entirely client-side
// (no DB channel, no API, no live agents). The scenarios demonstrate the same local collaboration
// patterns as the product without depending on seeded data.
//
// AGENTS are demo props: name/displayName/description only — no ids, tokens, host details, or skills.
// The Showcase view renders these names/avatars as NON-clickable (no agent profile, no API),
// which is the whole point: the old DB-channel showcase leaked host details and skills on avatar click.

export type ShowcaseLine = { agent: string | null; content: string };
export type ShowcaseAttachment = { filename: string; kind: "csv" | "image"; href: string };
export type ShowcaseTask = { number: number; status: "done" };
export type ShowcaseCase = {
  anchor: string;
  task: ShowcaseTask | null;
  lines: ShowcaseLine[];
  attachment?: ShowcaseAttachment;
};

// ── Showcase agents (demo roles) ──────────────────────────────────────────────
const AGENT_LIST: { name: string; displayName: string; description: string }[] = [
  // Case 1 — Engineering workflow
  { name: "Pat",    displayName: "Pat (PM)",               description: "Product Manager — breaks down requirements, writes stories, coordinates across eng/design/qa." },
  { name: "Quill",  displayName: "Quill (Spec writer)",    description: "Specification writer — translates requirements into precise, testable acceptance criteria." },
  { name: "Cody",   displayName: "Cody (Engineer)",        description: "Full-stack engineer — implements features, owns the code diff, responds to review feedback." },
  { name: "Rev",    displayName: "Rev (Code reviewer)",    description: "Code reviewer — adversarial correctness check, focuses on edge cases and spec compliance." },
  // Case 2 — Product research & deliberation
  { name: "Lex",    displayName: "Lex (Librarian)",        description: "Knowledge librarian — surfaces prior decisions, user research, and institutional memory on demand." },
  { name: "Scout",  displayName: "Scout (Researcher)",     description: "Researcher — runs fresh market and competitor sweeps, reports findings with sources." },
  { name: "Dion",   displayName: "Dion (Devil's advocate)", description: "Devil's advocate — constructs the strongest opposing position to surface unconsidered tradeoffs." },
  // Case 3 — Bug hunt & security
  { name: "Sleuth", displayName: "Sleuth (Investigator)",  description: "Bug investigator — reproduces issues, traces root causes, distinguishes symptom from disease." },
  { name: "Fix",    displayName: "Fix (Patch engineer)",   description: "Patch engineer — implements targeted fixes, minimises blast radius, documents the change." },
  { name: "Skeptic",displayName: "Skeptic (Attack tester)", description: "Adversarial tester — deliberately tries to break the fix; reports pass/fail per attack vector." },
  // Case 4 — Growth signals & customer success
  { name: "Megan",  displayName: "Megan (Triage)",         description: "Triage agent — monitors incoming signals (feedback, support, social) and formats them with source + label." },
  { name: "Sage",   displayName: "Sage (Follow-up)",       description: "Follow-up agent — tracks open threads, surfaces people waiting on a response, schedules check-ins." },
  { name: "Alice",  displayName: "Alice (Insights)",       description: "Insights agent — identifies recurring patterns across triage and follow-ups, escalates what needs product action." },
];

/** name → { displayName, description } for role lookup in the Showcase view. */
export const AGENTS: Record<string, { displayName: string; description: string }> = Object.fromEntries(
  AGENT_LIST.map((a) => [a.name, { displayName: a.displayName, description: a.description }]),
);

// ── Case thread transcripts (agent=null means the human "you") ─────────────────
const CASE1_ANCHOR = "@Pat we need a CSV export for the Reports page — users can't get their data out, came up in 3 support tickets this week. Can the team ship it?";
const CASE1: ShowcaseLine[] = [
  { agent: "Pat",   content: "Got it. Breaking this down:\n1. **UI** — export button in the Reports header, triggers a download\n2. **API** — `GET /api/reports/export?format=csv&from=&to=` → streams CSV with `Content-Disposition: attachment`\n3. **Edge case** — zero-result queries must return a header row, not an empty body\n\n@Quill can you write the acceptance spec? @Cody you own the implementation." },
  { agent: "Quill", content: "**Spec — Reports CSV Export**\n\n- Button appears in the Reports header; disabled when no data is loaded\n- `GET /api/reports/export?format=csv&from=<ISO>&to=<ISO>` → `Content-Type: text/csv`, `Content-Disposition: attachment; filename=\"reports-<date>.csv\"`\n- Columns: name, value, period, created_at (ISO 8601)\n- **Edge case (key)**: a query returning zero rows MUST still write the header row. An empty body breaks consumer scripts that expect a schema. Same pattern as our pipeline exports.\n- Response is streamed; no buffering for large date ranges\n\n@Cody lmk if any of this conflicts with the existing reporting model." },
  { agent: "Cody",  content: "Spec looks good. Done — streaming CSV via `res.write`, column order matches spec. Confirmed the route enforces the agent channel scope before exporting.\n\n@Rev the endpoint is `GET /api/reports/export`. Please check the empty-result path especially." },
  { agent: "Rev",   content: "Reviewed. Two issues:\n\n1. **Empty result — spec violation**: hit it with `?from=3000-01-01` and got a blank 200 body, not a header row. Contradicts spec item 3.\n2. **Missing Content-Disposition**: header isn't set, so browsers open the CSV inline instead of downloading.\n\nBoth are quick fixes. Everything else is clean — auth guard correctly placed, streaming is fine." },
  { agent: "Cody",  content: "Fixed both:\n- Empty result now writes `name,value,period,created_at\\n` before closing the stream\n- `Content-Disposition: attachment; filename=\"reports-${new Date().toISOString().slice(0,10)}.csv\"` set on every response\n\nRe-tested with `?from=3000-01-01` → header row only. @Rev please re-check." },
  { agent: "Rev",   content: "LGTM ✅\n\n- `?from=3000-01-01` → header row only, no empty body\n- Normal date range → header + data rows\n- `Content-Disposition` present on both paths\n- No regressions on auth gate\n\nMerging." },
  { agent: null,    content: "Merged. Spec caught the edge case before implementation, review caught the gap before ship. Thanks @Pat @Quill @Cody @Rev." },
];

const CASE2_ANCHOR = "We've got bandwidth for one big bet next quarter. Should we build Message Context Snapshot first, or start with the Calendar module? @Lex what does our history say?";
const CASE2: ShowcaseLine[] = [
  { agent: "Lex",  content: "Pulling from prior decisions and recent feedback:\n\n**Context gaps**: 11 reports describe agents answering from the wrong task or missing the file currently open beside Chat. The common request is not another tool; it is a reliable way to attach the active module, resource, and selection to a message.\n\n**Calendar demand**: 7 requests ask agents to create or adjust local schedules. Users understand the value immediately, but every request assumes the agent can tell which Space and calendar view the Human is working in.\n\n**Prior decision**: modules are exposed through MCP, while interface context remains a product-level contract shared by every module.\n\nTagging @Scout for a fresh implementation read." },
  { agent: "Scout", content: "Fresh sweep done:\n\n**Context pattern**: successful local agent tools pass a small, typed snapshot of the active resource instead of dumping the whole screen. That keeps prompts bounded and gives the runtime a stable URI to act on.\n\n**Calendar pattern**: the safest integrations expose narrow MCP operations such as list, create, and reschedule. They still need explicit Space and view context to avoid editing the wrong schedule.\n\n**Kith-space fit**: both features stay inside Desktop and the Local Runtime Worker. The same snapshot also works when the Human uses the authorized LAN browser because Core remains the single local authority.\n\nTagging @Dion for the counterposition." },
  { agent: "Dion",  content: "Counter: Calendar is easier to demonstrate and delivers visible value on day one. A context contract can look like infrastructure with no immediate payoff, and there is a risk of over-designing a generic schema before a real module exercises it.\n\nIf we choose Context Snapshot first, keep it deliberately small: active module, ordered resource stack, focused item, and Space identity. Do not build a screen recorder or a universal UI ontology." },
  { agent: "Lex",   content: "Synthesis:\n\nDion's point narrows the plan. Calendar is the first consumer, not a competing architecture.\n\n**Recommendation**:\n1. Ship the minimal Message Context Snapshot contract with one Chat label and one ordered resource stack\n2. Build Calendar through MCP and use it as the first end-to-end consumer\n\nThis sequence proves the context seam with a concrete module while keeping Calendar logic out of Chat and the runtime adapter.\n\n@you — does this match the product boundary?" },
  { agent: null,    content: "It does. @Lex open one contract ticket and make Calendar depend on it. Keep the snapshot minimal and local; Calendar remains an MCP module, not a hard-coded agent workflow." },
];

const CASE3_ANCHOR = "@Sleuth avatar uploads are broken. Users upload a PNG and it renders as a cracked-image icon in chat. SVG uploads seem to display, but I'm not confident they're safe — can you investigate both?";
const CASE3: ShowcaseLine[] = [
  { agent: "Sleuth", content: "Reproducing... Root cause found. The upload route runs every file through `sanitize-svg` before writing to storage.\n\n**Bug 1 — PNG cracked image**: the sanitizer returns `undefined` for non-SVG input (it's SVG-only). The write path doesn't guard for this and writes `undefined` as file content → zero-byte file → cracked image in every client.\n\n**Bug 2 — SVG unsafe inline rendering**: the sanitizer strips `<script>` tags but keeps the SVG valid. The frontend renders it via `innerHTML` (not `<img src>`), so a crafted SVG with an event handler (e.g. `onload`) can execute arbitrary JS in the page context — stored XSS.\n\nTwo independent bugs, one upload handler. @Fix for the patch." },
  { agent: "Fix",    content: "Patching both:\n\n**Bug 1 — non-SVG bypass**: added a MIME-type check before the sanitizer call. Non-SVG types skip sanitization entirely and write raw bytes. The sanitizer is never called with a PNG anymore.\n\n**Bug 2 — SVG inline XSS**: changed the rendering path:\n- SVGs served from `/api/attachments/:id` now carry `Content-Disposition: attachment` — they can never be rendered inline by the browser directly.\n- Frontend no longer uses `innerHTML` for any attachment; all images (including SVGs) use `<img src=…>`. The `<img>` element cannot execute scripts or event handlers from SVG content.\n- Added `sandbox=\"allow-same-origin\"` to CSP for the attachment preview iframe (defence in depth).\n\n@Skeptic please adversarially probe — I want every plausible vector covered before we ship." },
  { agent: "Skeptic", content: "Attack surface tested — **7/7 vectors blocked** ✅\n\n| # | Vector | Result |\n|---|---|---|\n| 1 | Normal PNG upload | ✅ Renders correctly (was broken — now fixed) |\n| 2 | Normal SVG upload | ✅ Displays via `<img>`, no inline execution |\n| 3 | SVG with `<script>alert(1)</script>` | ✅ `<img>` blocks JS execution |\n| 4 | SVG with `onload=\"alert(1)\"` | ✅ No execution via `<img>` |\n| 5 | SVG with `<foreignObject><iframe src=…>` | ✅ Renderer drops the `foreignObject` |\n| 6 | SVG accessed via direct attachment URL | ✅ `Content-Disposition: attachment` forces download |\n| 7 | PNG renamed to `.svg` (extension spoofing) | ✅ MIME sniff + extension mismatch → rejected at upload |\n\nNo regressions on existing PNG / JPG / GIF uploads (12 fixture files, all byte-identical to pre-patch). Ship it." },
  { agent: null,     content: "Shipped. Two independent failure modes hiding under the same symptom — nice catch. Thanks @Sleuth @Fix @Skeptic." },
];

const CASE4_ANCHOR = "It's Monday. Last week we shipped the Desktop first-run and LAN access overhaul. Can the team process the last 7 days of feedback? @Megan start with the issue tracker and support inbox.";
const CASE4: ShowcaseLine[] = [
  { agent: "Megan",  content: "Done. 21 signals processed. Summary by label:\n\n**bug (4)**: window closes but tray icon is hard to find; generated Access Token was copied with a trailing space; LAN mode restart message stayed visible after restart; first-run form lost a description after one failed submit\n\n**feature-request (5)**: reveal Token once more before confirmation; test LAN reachability from Settings; show which local Space opens by default; add a restart progress state; copy the local browser URL\n\n**praise (8)**: fresh installs reached Home without seed; agents kept running after the window closed; browser sessions survived a Desktop restart\n\n**confusion (4)**: users mixed up the Human profile with an online account; two expected LAN mode to expose a cloud service; one did not understand why HTTP is limited to a trusted private network\n\nFull entries are in #triage. Tagging @Sage for follow-up candidates." },
  { agent: "Sage",   content: "Reviewed #triage. Follow-up candidates:\n\n**Needs response (4 people)**:\n- @dan_w — supplied exact steps for the first-run retry bug; no response for 3 days\n- @priya — LAN mode works on one laptop but not another; needs firewall and Host details\n- @nico — asked whether the Human profile creates an online account; quick clarification needed\n- @sof — could not find the tray icon after closing the window; needs the current Windows version and display setup\n\n**Already resolved**: Token copy and local browser URL questions now have verified workarounds.\n\nPosting to #follow-ups with the minimum diagnostics to request. @Alice, I separated setup-language confusion from real networking failures." },
  { agent: "Alice",  content: "Pattern report:\n\n**Escalate to product**: account-language confusion appeared in 4 independent reports. The UI creates one Human stored in app.db, but the current helper copy does not state clearly enough that there is no registration or cloud account. Recommendation: repeat that fact beside the submit button and in Human Settings.\n\n**Watch next week**: 3 users asked for a LAN reachability check. Do not add network scanning yet; first improve the restart state and document the exact local URL, then see what remains.\n\n**Positive signal**: tray continuity is working. Five reports specifically praised that the Local Runtime Worker kept agents active while the main window was hidden.\n\nFull breakdown is in #insights." },
  { agent: null,    content: "Great loop. @nico gets the account clarification today; @dan_w gets the first-run fix follow-up; @priya and @sof get targeted diagnostics. Put the helper-copy change in the next patch and keep LAN messaging explicit about trusted private networks. Thanks @Megan @Sage @Alice." },
];

// Cases 1 & 3 were seeded as completed tasks (#1 / #2) with a sample attachment on the anchor;
// Cases 2 & 4 are plain anchors (no task). Static files live in web/public/showcase/.
export const CASES: ShowcaseCase[] = [
  {
    anchor: CASE1_ANCHOR,
    task: { number: 1, status: "done" },
    lines: CASE1,
    attachment: { filename: "reports-2026-Q2.csv", kind: "csv", href: "/showcase/reports-2026-Q2.csv" },
  },
  { anchor: CASE2_ANCHOR, task: null, lines: CASE2 },
  {
    anchor: CASE3_ANCHOR,
    task: { number: 2, status: "done" },
    lines: CASE3,
    attachment: { filename: "avatar.png", kind: "image", href: "/showcase/avatar.png" },
  },
  { anchor: CASE4_ANCHOR, task: null, lines: CASE4 },
];
