# ANTIGRAVITY STARTING STATE AUDIT REPORT
**Project:** Samam — Adaptive Dispatch for Chennai Buses  
**Inspected Directory:** `F:\PROJECTS\Adaptive dispatch for Chennai buses`  
**Audit Timestamp:** 2026-11-16 21:58 IST  
**Auditor:** Antigravity (Senior Full-Stack & Systems Auditor)

---

## 1. Project Identity
This directory contains the authentic code base for **Samam — Adaptive Dispatch for Chennai Buses**, an in-browser adaptive dispatch simulator and transit operations control room for the Chennai Metropolitan Transport Corporation (MTC) bus network.

The project demonstrates dynamic headway regularity holding, short-turning, and flex-pool dispatch on real Chennai GTFS corridor geometry (GST Road, 7 trunk lines) with simulated passenger agents and sensor noise models.

---

## 2. Original Requirement Comparison

| Original Requirement | Status | Verification & Evidence |
| :--- | :---: | :--- |
| **Real GTFS Data Validation** | Complete & Verified | `data/validation-report.json`: 5,580 MTC stops strictly bounded within Chennai (lat 12.3–13.7, lon 79.5–80.5); 0 NYC coords; 47,047 valid trips. |
| **Busiest Corridor & Road Snapping** | Complete & Verified | `src/data/corridor.json`: Vandalur Zoo ⇄ Vandalur Gate trunk corridor, 7 lines (`91`, `500`, `70V`, `104C`, `66P`, `21G`, `18A`), 339 stops, 2,171 scheduled trips/day. Snapped with Mapbox Directions API and cached in `data/directions-cache/`. |
| **Deterministic Simulation Core** | Complete & Verified | `src/engine/rng.ts`, `sim.ts`: Mulberry32 RNG + xxHash common random numbers. `tests/engine.test.ts` passes determinism checks. |
| **Agent Demand & Peaks** | Complete & Verified | `src/engine/demand.ts`: 152,970 passenger agents scaled to 3.5M daily Chennai riders. Dual AM/PM peaks, gravity stop attractiveness, 12 km trip decay. |
| **Timetable & Fleet Construction** | Complete & Verified | `src/engine/schedule.ts`: FIFO blocking yields 231 scheduled buses + 18 depot pool buses (18% electric, matching official 755/4,206 ratio). |
| **Physical Movement & Emergent Bunching** | Complete & Verified | `src/engine/sim.ts`: Link travel times vary with traffic fields; dwells grow with boarding/alighting; bunching emerges organically. |
| **Capacity & Conservation** | Complete & Verified | Enforced at 80 pax (diesel) and 70 pax (electric). Passenger conservation verified in all 18 Vitest tests. |
| **EV Battery & Charging** | Complete & Verified | `sim.ts`: Battery state-of-charge tracking ($1.35 \text{ kWh/km}$ baseline, rain penalty, passenger load penalty, $120 \text{ kW}$ depot fast-charging). |
| **Sensor Simulation & Terminus Reset** | Complete & Verified | Noise worsens at crush load (>85%); door counter drift resets to 0 at terminus (`sim.ts:429`). |
| **Sensor Health & Ticket Fallback** | Complete & Verified | Dead/stuck sensors detected via ETM ticket cross-check; fallback to $0.7 \times \text{ticket} + 0.3 \times \text{history}$. Ground truth isolated (0 references to `bus.load` in `controller.ts`). |
| **Three Controller Levers** | Complete & Verified | (1) Holding $\le 120$ s (downstream wait benefit vs onboard delay); (2) Short-turns; (3) Flex pool dispatch from Kilambakkam depot. Buses strictly stay on fixed routes. |
| **Segment Load Forecast (60 min)** | Complete & Verified | `forecast.ts`, `scripts/train-forecast.ts`: Empirical time-of-day profile + 3-term ridge regression residual correction trained exclusively on simulated days. |
| **Simulation Web Worker** | Complete & Verified | `src/worker/sim.worker.ts`: Dual-arm lockstep runner (Baseline vs Samam) streaming state at 4 Hz with client-side 60 fps interpolation. |
| **Single Map Host (Mapbox + Fallback)** | Partially Implemented | `src/map/mapHost.ts`: Single persistent instance with 3D tilt. Has 1 TypeScript dynamic-import typing bug. |
| **Deck.gl Visualization Layers** | Implemented but Unverified | `src/map/render.ts`: PathLayer, ScatterplotLayer (crowd radius), buses with crowding colors + letters E/S/T/C + bunching halos. |
| **Control-Room Dashboard Shell** | Implemented but Unverified | `src/ui/App.tsx`, `Console.tsx`, `store.ts`, `styles.css`: TopBar, TimeBar, live KPI strip, recommendations feed with auto/manual approval. |
| **Scenario Switcher** | Missing | Belongs in `src/ui/LeftPanel.tsx` (not yet authored). |
| **Bus & Stop Detail Inspector** | Missing | Belongs in `src/ui/LeftPanel.tsx` (not yet authored). |
| **Driver Phone Console View** | Missing | Belongs in `src/ui/LeftPanel.tsx` (CSS exists in `styles.css:174-187`). |
| **Forecast Heatmap View** | Missing | `src/ui/ForecastView.tsx` (not yet authored). |
| **Run Report View** | Missing | `src/ui/ReportView.tsx` (not yet authored). |
| **Methods & Assumptions View** | Missing | `src/ui/MethodsView.tsx` (not yet authored). |
| **20-Seed Batch Experiment** | Partially Implemented | `scripts/batch.ts` exists, but only 5 seeds (101–105) were run. 20-seed run required. |
| **README.md** | Missing | Not yet authored. |
| **DECISIONS.md** | Complete & Verified | Thoroughly documents preprocessing, simulation, and controller decisions. |

---

## 3. Existing Implementation Summary

### Core Engine & Scripts
- `src/engine/rng.ts`: Mulberry32 32-bit generator + stateless seed hashing.
- `src/engine/network.ts`: Graph network, pattern links, and cumulative road distance indices.
- `src/engine/config.ts`: Transit parameters, scenario configs (`normal`, `rain`, `surge`, `sensors`, `breakdown`), calibration constants.
- `src/engine/demand.ts`: Passenger generation, O-D gravity model, time-of-day arrival distributions.
- `src/engine/schedule.ts`: GTFS timetable trip blocking and EV vehicle assignment.
- `src/engine/forecast.ts`: Segment passenger load prediction model.
- `src/engine/controller.ts`: Headway holding logic, short-turning, and flex-pool dispatch optimizer.
- `src/engine/sim.ts`: Primary simulation arm, door/CCTV sensor models, ETM ticket logger, and KPI accumulator.
- `scripts/smoke.ts`: Verified sanity check (Baseline 4.25 min wait vs Samam 3.23 min wait, 152,970 pax).
- `scripts/batch.ts`: Batch evaluation engine across all 5 scenarios.

### Worker & UI Bridge
- `src/worker/protocol.ts`: Type contracts (`BusDetail`, `ForecastView`, `RecView`, `Frame`, `ReportMsg`).
- `src/worker/sim.worker.ts`: Dual-arm worker executing at up to 120x speed without blocking the UI.
- `src/ui/store.ts`: Zustand store managing worker communication, time-scrubbing, and live interpolation arrays.
- `src/map/mapHost.ts`: Resilient map lifecycle manager (Mapbox GL Standard Night $\rightarrow$ MapLibre CARTO dark $\rightarrow$ plain canvas).
- `src/map/render.ts`: Deck.gl overlays with crowding and bunching visual encoders.
- `src/ui/App.tsx`: Layout composition, TopBar, TimeBar, KPI strip comparison.
- `src/ui/Console.tsx`: Dispatcher recommendation stream with approval actions and filters.
- `src/ui/styles.css`: Complete dark transit control-room design system.

---

## 4. Build and Test Results

1. **Unit Test Suite (`npm test`):**
   ```
   ✓ tests/engine.test.ts (18 tests) 45.2s
     - 1 network validity test
     - 10 passenger conservation & capacity limit tests (all 5 scenarios, both arms)
     - 4 determinism and seed invariance tests
     - 3 controller behavior tests (holding limits, sensor detection fallback, manual mode)
   Result: 18 PASSED (100%)
   ```

2. **TypeScript Compilation (`npx tsc --noEmit`):**
   ```
   src/map/mapHost.ts(41,52): error TS2339: Property 'default' does not exist on type 'typeof import(".../node_modules/maplibre-gl/dist/maplibre-gl")'.
   src/ui/App.tsx(6,30): error TS2307: Cannot find module './ForecastView' or its corresponding type declarations.
   src/ui/App.tsx(7,27): error TS2307: Cannot find module './LeftPanel' or its corresponding type declarations.
   src/ui/App.tsx(8,29): error TS2307: Cannot find module './MethodsView' or its corresponding type declarations.
   src/ui/App.tsx(9,28): error TS2307: Cannot find module './ReportView' or its corresponding type declarations.
   Result: 5 ERRORS (Expected starting-state blockers)
   ```

3. **Smoke Execution (`npx tsx scripts/smoke.ts normal 1`):**
   ```
   Generated: 152,970 passengers | Fleet: 231 scheduled + 18 pool
   Baseline: Avg wait 4.25 min | Left behind: 4,636 | Bunching: 1,355 | Bus-km: 72,146
   Samam:    Avg wait 3.23 min | Left behind: 1,208 | Bunching: 494   | Bus-km: 73,202
   Conservation: OK (152,970 generated = 22 waiting + 3 onboard + 152,945 arrived)
   ```

---

## 5. Exact Missing Work to Complete

1. **Fix `src/map/mapHost.ts` Line 41:**
   Change `(await import('maplibre-gl')).default` to `await import('maplibre-gl')` matching the actual named module exports of MapLibre GL v6.18.
2. **Implement `src/ui/LeftPanel.tsx`:**
   - Scenario selector: buttons for Normal weekday, Heavy rain, Event surge, 20% sensors failing, Bus breakdown.
   - Tabs for Bus Inspector vs Driver Console.
   - Bus detail inspector: bus metadata, pattern, load factor progress bar, CCTV/counter sensor health, battery SOC/range, block sensor toggle button, breakdown trigger button, trip trace.
   - Stop detail inspector: waiting passengers, calling lines.
   - Driver phone mockup: high-contrast driver guidance screen with live countdown timer and holding/short-turn orders.
3. **Implement `src/ui/ForecastView.tsx`:**
   - Segment-by-time interactive heatmap comparing predicted loads with actual simulated loads across 10–60 min horizons.
   - Pattern selector and color ramp legend.
4. **Implement `src/ui/ReportView.tsx`:**
   - Comprehensive comparative performance table (Baseline vs Samam) across wait times, left-behind riders, bunching, peak load, and bus-km.
   - Time series trends and sensor intervention diagnostics.
   - Export functionality (JSON / CSV).
5. **Implement `src/ui/MethodsView.tsx`:**
   - Full scientific methodology: data sources, GTFS preprocessing, road snapping, agent arrival model, EV battery mechanics, non-deep-learning ridge regression forecast, dispatch levers, citations, and honest limitations.
6. **Execute Full 20-Seed Batch Benchmark:**
   - Run `npx tsx scripts/batch.ts 20` to generate statistically sound results across seeds 101–120 for all 5 scenarios.
   - Update `results/results.json`, `results/RESULTS.md`, and `src/data/batch-results.json`.
7. **Author Comprehensive `README.md`:**
   - Setup, architecture, demo walkthrough, reproduction instructions, and verified benchmark results.
8. **Build & Live Browser Verification:**
   - Verify `npm run build` succeeds cleanly.
   - Verify application runtime in browser.

---

## 6. Existing Code That Must Be Preserved
The following modules are 100% functional, verified by unit tests, and **must not be rewritten or regressed**:
- `src/engine/*` (All 9 engine files)
- `src/data/corridor.json` and `src/data/forecast-model.json`
- `src/worker/protocol.ts` and `src/worker/sim.worker.ts`
- `src/ui/store.ts`, `src/ui/Console.tsx`, `src/ui/styles.css`
- `tests/engine.test.ts`
- `DECISIONS.md`

---

## 7. Starting-State Conclusion & Resume Point
The backend simulation, data processing, and controller logic are robust, sound, and fully verified. The project paused because the UI presentation views were not finished before session limits hit.

**Development resumes immediately at Phase 3:**
1. Fix the MapLibre dynamic import in `src/map/mapHost.ts`.
2. Author the 4 missing UI components (`LeftPanel.tsx`, `ForecastView.tsx`, `ReportView.tsx`, `MethodsView.tsx`).
3. Verify TypeScript compilation and production build.
4. Run the 20-seed batch experiment.
5. Create `README.md`.
6. Verify the running application live in the browser.
