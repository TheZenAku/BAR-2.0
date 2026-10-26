# Engine POC results (M0, 2026-10-26)

Raw data: `bench-msedge.json`, `bench-msedge-uncapped.json`, `bench-firefox.json`, `bundle-sizes.json`,
`gltf-validation.json`; full table (medians): [summary.md](summary.md); screenshots: `screens/`.

## Environment (real, measured)

| Item | Value |
|---|---|
| Machine | **VMware virtual machine**, Windows 10 Pro 19045, Intel i5-13400F (virtualized), 8 GB RAM |
| GPU | **VMware SVGA 3D (virtual GPU)** — Edge: ANGLE D3D11 on VMware SVGA; Firefox: **Microsoft Basic Render Driver (software)** |
| Browsers | Edge (Chromium) 156 headless via Playwright `channel: msedge`; Firefox 157 (Playwright build) headless |
| Runtime | Node 26.12.1, Vite 8.3.5, TypeScript 7.0.2, Playwright 1.64.1 |
| Engines | three 0.186.1 (r186), @babylonjs/core 9.32.0, playcanvas 2.23.3; physics @dimforge/rapier3d-compat 0.21.0 |

> **Validity limits.** All numbers come from a virtualized GPU. They are useful for **relative** comparison between engines
> under identical conditions, **not** as absolute targets for player hardware. Firefox used software rendering, so its FPS
> numbers measure CPU rasterization and are **not representative** of GPU performance (they only prove functional
> compatibility). Physical-hardware measurement is a planned M1/M12 item. Status of absolute performance: **NÃO VERIFICADO**.

## Functional equivalence (all ✅ in Edge and Firefox)

GLB scene, skinned avatar with Idle↔Walk cross-fade, third-person camera with collision, Rapier kinematic movement and
collision, directional shadows + 4 point lights + fog + tone mapping, 1/16/48 avatars, DOM HUD. 84/84 benchmark runs completed,
0 page errors. The only console error was one HTTP 404, always on the first page of each browser session (three, n=1);
most likely the browser's automatic `/favicon.ico` request (the POC has no favicon) — URL not captured, so not proven.
Firefox note: in one Babylon screenshot the player had walked out of the bar door (the scripted path is frame-rate dependent
because `dt` is clamped at 50 ms); a dedicated re-check (`tools/ff-check.mjs`) rendered the scene correctly with and without shadows.

## Key results — Edge, vsync uncapped (`--disable-gpu-vsync --disable-frame-rate-limit`), median of 2 runs

| Case | Metric | Three.js | Babylon.js | PlayCanvas |
|---|---|---|---|---|
| 16 avatars, shadows | FPS / frame p95 (ms) | 220 / 5.9 | 197 / 6.6 | **248 / 5.4** |
| 48 avatars, shadows | FPS / frame p95 (ms) | 117 / 10.6 | 102 / 12.1 | **150 / 8.7** |
| 48 avatars, shadows | main-thread CPU p95 (ms) | 8.3 | 9.8 | **6.0** |
| 48 avatars, shadows | draw calls (incl. shadow pass) | 560 | **401** | 557 |
| 48 avatars, no shadows | FPS | 134 | 125 | **176** |
| 48 avatars, shadows | JS heap (MB) | **23** | 63 | 44 |
| any | load to first frame (ms, local server) | **~560** | ~920–1150 | ~640–680 |
| any | engine JS downloaded, gzip (KB) | **~155** (1 file) | ~620 (85 lazy files) | ~300 (1 file) |

With the 60 Hz cap (Edge, 3 runs) all three hold ~62 FPS in every case; frame p95 ≈ 22–24 ms for all three (vsync jitter of
the headless VM compositor, equal across engines).

Rapier (`-compat`, WASM inlined as base64) adds **1604 KB gzip** to every POC — larger than any engine. Mitigation to evaluate
in M1: the non-compat build (separate `.wasm`, streaming compile, cacheable) and the deterministic build required for
cross-platform server authority.

## Observations that matter for the decision

- **PlayCanvas**: best runtime throughput and lowest CPU per frame here; engine-only workflow works but the standalone API
  (`AppBase`, manual component/handler registration) is less documented than the Editor path; triangle stats only in the profiler build.
- **Babylon.js**: richest feature set (automatic instancing of shared glTF meshes gave the fewest draw calls, Inspector,
  retargeting, WebGPU parity); costs: largest download (~4× Three), highest heap, slowest load, and lowest FPS in this scene.
- **Three.js**: smallest download and heap, fastest load, mid throughput; no automatic instancing (repeated props cost one
  draw call each → `InstancedMesh`/`BatchedMesh` needed in M6); no semver (pin exact version, upgrade deliberately).
- All three loaded the same GLBs without changes; avatars needed manual bounds handling (skinned bounds are bind-pose only).
- Rapier runs in Node 26 (verified) — shared simulation for client prediction and server authority is viable with any engine.
  Pitfall found: the broad phase is only populated by `world.step()`; queries before the first step see an empty world.
- glTF-Validator: both GLBs 0 errors; avatar has 1 warning `NODE_SKINNED_MESH_NON_ROOT` → pipeline convention: skinned mesh nodes at scene root.
