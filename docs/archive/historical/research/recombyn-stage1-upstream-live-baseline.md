# Recombyn Stage 1 live baseline and native-port comparison

Captured 2026-08-15 with the user-designated Chrome control extension. The upstream tab remained at `http://localhost:3001/zh/editor/L1mnfYDHFUsrc79v8j9a-`; the Kith development harness was `http://127.0.0.1:5273/?__canvas_stage1=1`. Upstream source was a clean `abd81983716b41c7fc6e2f591c23e6d9bb9c4643` checkout.

## Comparison contract

- CSS viewport: 1512 x 712. Upstream DPR was 1. Kith Chrome was at 90% zoom (DPR 0.9); CDP emulation fixed the CSS viewport and the captures were normalized to real JPEG 1512 x 712.
- Operation order: overview -> select image -> shape menu -> layers -> assets -> minimap -> shortcuts -> export -> dark theme; then resize AgentDock/layers, focus-title shortcut guard, Hand pan, wheel zoom, image drag, and selection-to-chat.
- The upstream editor's own `Export JSON` action produced the fixture used by Kith (original SHA-256 `665aac2e159423f8fad9fff06b49ea21fc1e35308d010525d920dde99fe87f42`). One signed online generated-image URL had no auditable redistribution/license conclusion, so Kith substitutes a same-size local neutral SVG; the checked-in fixture SHA-256 is `647dedce04fada8a1faa2344d7cb7a19b5d7022e3768c8f9a22d718a4e58a335`. All scene structure, IDs and remaining values are the upstream export. This is the sole approved visual exception, so screenshots are state comparisons rather than pixel-equality goldens.
- The Chrome control extension frog is browser UI, not product DOM.

## Frozen upstream evidence

The selected-image file is the user's supplied read-only `04-image-context-toolbar.png` baseline, normalized from 1512 x 716 to the fixed 1512 x 712 evidence viewport without changing state; the other rows were captured from the same designated live Chrome session.

| State | File | SHA-256 |
|---|---|---|
| overview | `recombyn-stage1-baseline/upstream/01-overview-1512x712.jpg` | `bdd1227339ad8eb13ffd310eda5fa6232b459c3748224aa70aa1c87adac5ab69` |
| shape menu | `02-shape-menu-1512x712.jpg` | `2005d3b9e0b250edee40ffec4953f456181cbbd5141f65d6f9c2670852cf579d` |
| layers | `03-layers-panel-1512x712.jpg` | `254203d693080521290ffa1c923f91db0421bff5a5833656230d410a2c80852c` |
| selected-image toolbar | `04-image-context-toolbar-1512x712.jpg` | `1d0a1a89bbe6e9a0bca50d51350bcfc8a5ce826840999fa0aaa15c311f78b6c5` |
| export | `05-export-menu-1512x712.jpg` | `16663891779b9d14792cb0f4e09dbdb6a9fd03ab486763ca3ba1c26b3800ea47` |
| assets | `06-assets-panel-1512x712.jpg` | `914be2a6b1b01e84111bb7f99d0593387075a6b7127d1074a6d01ef26cd68f8b` |
| minimap | `07-minimap-1512x712.jpg` | `ca17605e3ea7aec67d18e9916f021e90cd9e2dfb35f3711409d1095689b479ff` |
| shortcuts | `08-shortcuts-dialog-1512x712.jpg` | `120d6135c06b0123c1b7277320355e94a636de7c1064299a0cc27e153646768e` |

## Kith native-port evidence

All files are under `recombyn-stage1-native-baseline/`. The 1512 x 712 captures freeze the full native chrome parity states gathered before the AgentDock correction; the corrected final composition is recorded separately at 1107 x 807 and is the completion evidence for the no-Dock boundary.

| State | File | SHA-256 |
|---|---|---|
| overview | `kith-native-overview.jpg` | `a5dad49ef5dbd8d8e09dc0773311dd1f27f219df682b6a57e5bb6aa100d5e49c` |
| selected-image toolbar | `kith-native-selected-image-toolbar.jpg` | `0cd840b69d51a0e8d032994e6372c611a4d29be6ab08f18c82d1cb991d9c767e` |
| shape menu | `kith-native-shape-menu.jpg` | `b8310669cefa5601bea6cd2a32fd50d93c727505fe586bc4391035d5dcdce1ac` |
| layers | `kith-native-layers-panel.jpg` | `c1a58f3a36368311458e4da81039c2a7961621aed1229deff4ac230a2735b3e6` |
| assets | `kith-native-assets-panel.jpg` | `9d679265d260b968f1b000593f83e57fbb02cacaec5d0f0c3a131e6f52214dab` |
| minimap | `kith-native-minimap.jpg` | `ce1519967695f1784e16274575a2e3cef851c14b5d73125940dfb2f4d2a58754` |
| shortcuts | `kith-native-shortcuts.jpg` | `53f2e474895eb2cc99c782dc0195b04aecefe0662abddcca4f2d3cc19217f4b6` |
| export | `kith-native-export-menu.jpg` | `ba62f19cee13a08e2578e0a9c7b225ce8baebf64eeca6e97a807cdabe222a3c2` |
| dark | `kith-native-dark.jpg` | `acbb7884651184eb1dbe5db822b12b9ef1192388ef0bd37f00a96268fe0699ac` |
| corrected final no-Dock composition | `kith-native-corrected-final.jpg` | `769840067e1ba8d881958e51715d48fa6a08e369a580e3f0c5675871a7d84a93` |

## Observed parity and intentional host seams

- Native top bar, frame labels, toolstrip, six-item shape menu, resizable push-layout layers/assets panels, minimap, five-section shortcuts dialog, selection toolbar and zoom controls are present. The corrected composition has no AgentDock, Dock toggle, placeholder or reserved width.
- A separate clean Chrome profile confirmed that a fresh navigation replays both exported Frames and all scene nodes; the overview is genuinely unselected and the selected-image capture was produced by clicking the fixture image, so these two evidence files no longer alias the same bytes.
- Export retains the native menu interaction but uses Frame/Canvas wording and is disabled until a Kith export port exists. Upload, image generation, remote image editing and Agent sending are visibly disabled. Selection-to-chat remains locally demonstrable as a composer context chip.
- Layers resized 320 -> 420 px and pushed the canvas by 100 px. Title focus suppressed tool shortcuts; `H` outside an editable activated Hand. With the exported fixture, a 120 px pointer move panned a frame by 120 px and the selected image moved by `(78.66,19.91)` px. The equivalent upstream drag moved by `(83.13,19.95)` px and was immediately undone through the native history command.
- The corrected generator run selected and moved an image-generator node by `(121.5, 60)` CSS px, changed its prompt, attached one canvas image as a local `data:` reference, and exercised image and video unavailable submits. The only observed request was that local data URL; Recombyn image/video/audio Job and upload requests were zero. Reload restored the same 19-node ID set, including both new generator nodes.
- Kith host body kept Sora while the island used the native Alibaba/PingFang/Microsoft YaHei/Noto stack. The island portal root was a child of the island and held 13 portal subtrees. Dark tokens changed only the island (`canvas #1e1e1e`, `surface #2c2c2c`).
- Final navigation produced no application error or framework overlay and no wallet/Core request or API-key warning; Chrome logged only two React Router future warnings. Upstream itself logged remote-image fetch/export warnings, so those remote abilities are not treated as a portable baseline.

The machine-readable values and limitations are in `recombyn-stage1-browser-evidence.json`; performance protocol is in `recombyn-stage1-visual-performance-baseline.md`.
