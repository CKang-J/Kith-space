# Recombyn Stage 1 visual and performance protocol

## Environment and repeatable operation

- Machine: Apple M1 Pro, 32 GiB RAM; Chrome 151.0.0.0.
- Source: Recombyn `abd81983716b41c7fc6e2f591c23e6d9bb9c4643`; Kith working tree based on `8ec8a48791e8c9fdf252fdb3039fd873ae89686a`.
- Viewport: 1512 x 712 CSS pixels. Capture each state listed in the live-baseline document after a fresh navigation.
- Interaction sequence: activate Hand and pan 120 px with 60 pointer moves; dispatch 60 alternating wheel events; select the image and drag it with 60 pointer moves. The first live comparison recorded 120 consecutive `requestAnimationFrame` intervals during each gesture. A follow-up probe records each active pointer/wheel input's delay to the next rAF callback and reports p50/p95; it intentionally does not call this browser refresh interval “render frame time”. Record cold and warm time from navigation start until the boot overlay is absent and the editor main region exists.
- Visual assertions: export-button box/type/radius/shadow, default and resized side widths, island font stack, host font non-interference, light/dark tokens, portal ancestry, editable-target shortcut guard, disabled external controls and the selection-to-chat seam.

## 2026-08-15 results

| Measurement | Upstream live | Kith native port |
|---|---:|---:|
| first meaningful paint from CDP navigation | 344.84 ms | not repeated after native replacement |
| DOM content loaded from CDP navigation | 76.76 ms | not repeated after native replacement |
| cold editor-ready observation | not captured | 2616.6 ms |
| warm editor main + two-frame ready observation | not captured | 1965 ms wall |
| Hand pan rAF interval p50/p95, 120 samples | 8.30 / 9.90 ms | 8.30 / 10.20 ms |
| wheel zoom rAF interval p50/p95, 120 samples | 8.30 / 10.20 ms | 8.30 / 10.30 ms |
| image drag rAF interval p50/p95, 120 samples | 8.30 / 9.40 ms | 8.30 / 10.30 ms |
| Hand input -> next rAF callback p50/p95, 60 samples | not rerun after authenticated tab expired | 2.10 / 6.00 ms |
| wheel input -> next rAF callback p50/p95, 60 samples | not rerun after authenticated tab expired | 0.10 / 0.20 ms |
| image-drag input -> next rAF callback p50/p95, 60 samples | not rerun after authenticated tab expired | 0.10 / 0.30 ms |

The original specification sets no 1500 ms threshold. The 1.97 s warm editor-ready result is nevertheless a recorded Stage 1 risk, not a pass claim. Recombyn intentionally keeps its boot overlay for at least 520 ms and exits over 280 ms; the remainder needs production-host profiling before a product SLO is chosen.

The paired rAF-interval series used the upstream-exported scene structure and identical operation sequence, but it mainly reflects display refresh cadence and is retained only as a diagnostic record. The corrected active-input probe was rerun on the Kith port in a clean Chrome 151 profile; the authenticated upstream tab had expired by that follow-up, so no paired upstream value is claimed. The only fixture content difference remains the documented license-safe local replacement for the signed online image. These values are a repeatable protocol and risk baseline, not a product SLO or pixel-equality claim.

Document load/save, mutation commit, ledger growth and durable asset/export metrics do not exist in the Stage 1 in-memory island and are intentionally deferred to the stages that introduce those systems. No value is invented for them.
