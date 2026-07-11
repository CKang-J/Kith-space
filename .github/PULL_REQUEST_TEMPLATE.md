## Summary

<!-- 1-3 bullets describing what this PR does and why. -->

-

## Motivation / linked issue

<!-- Closes #N / Relates to #N / Standalone improvement -->

## Changes

<!-- List the files changed and why. Keep the diff surgical. -->

## Test plan and evidence

<!-- Paste real output or observations, not only an expected result.

Examples:
- Domain/API changes: focused test plus `pnpm test --integration`
- Frontend changes: browser screenshots or interaction notes from a running app
- Desktop/runtime changes: `pnpm run desktop:dev` or packaged smoke evidence
- Packaging changes: `pnpm run desktop:pack` and, when relevant, `pnpm run desktop:dist`
-->

```text
# paste evidence here
```

## Documentation sync

Check the applicable items. The source of truth is `AGENTS.md` and `docs/progress.md`.

- [ ] Commands or scripts changed -> `docs/dev-commands.md` updated; `README.md` and `AGENTS.md` checked
- [ ] Architecture, API, data model, or guard changed -> `docs/kith-space/architecture-proposal.md` updated
- [ ] UI information architecture changed -> `docs/kith-space/ui-direction.md` updated
- [ ] Product or architecture decision changed -> `docs/decisions.md` updated; `docs/vision.md` / `docs/roadmap.md` checked
- [ ] Terminology changed -> `docs/glossary.md` updated
- [ ] Stage progress changed -> `README.md`, `docs/progress.md`, and `docs/roadmap.md` updated
- [ ] No documentation change is needed (explain why below)

**Documentation note:**

## Verification bar

- [ ] `pnpm run typecheck`
- [ ] `pnpm test --unit`
- [ ] `pnpm test --integration`
- [ ] `pnpm run desktop:bundle`
- [ ] Relevant real-run, browser, or packaged smoke evidence is included above
- [ ] Anything not verified is listed below

**Not verified / skipped:**
