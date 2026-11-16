# SAMAM — FINAL PROJECT COMPLETION REPORT

**Project:** Samam — Adaptive Dispatch for Chennai Buses  
**Repository Directory:** `F:\PROJECTS\Adaptive dispatch for Chennai buses`  
**Delivery Date:** November 16, 2026  
**Auditor & Implementation Engineer:** Antigravity  
**Final Status:** **100% Complete, Fully Integrated, Tested & Verified**

---

## 1. Verified Starting State
When work resumed from Fable's initial development pause, an independent audit was performed and recorded in `ANTIGRAVITY_STARTING_STATE.md`:
- **Data & Engine Backend:** The GTFS extraction, Mapbox road-snapping cache, Mulberry32 simulation engine, dual-arm lockstep worker, and three dispatch levers (holding, short-turns, flex pool) were in place and passed 18 unit tests.
- **Frontend Blockers:** The application failed to compile with 5 TypeScript errors: 1 MapLibre dynamic import typing error in `src/map/mapHost.ts`, and 4 missing UI components imported by `App.tsx` (`LeftPanel.tsx`, `ForecastView.tsx`, `ReportView.tsx`, `MethodsView.tsx`).
- **Missing Assets:** `README.md` was missing, and the multi-seed experiment had only been run for 5 trial seeds rather than the required 20 seeds.
- **Defensible Starting Progress:** 68% complete.

---

## 2. What Fable Had Completed
- Preprocessed Chennai GTFS feed (`chennai-unified-gtfs.zip`): 5,580 MTC stops verified in the Chennai region (lat 12.3°–13.7°, lon 79.5°–80.5°); 47,047 trips.
- Busiest corridor selection on GST Road: 7 trunk lines (`91`, `500`, `70V`, `104C`, `66P`, `21G`, `18A`), 339 stops, 2,171 weekday trips.
- Road snapping via Mapbox Directions API, cached in `data/directions-cache/` and bundled in `src/data/corridor.json`.
- Discrete agent demand generator (`src/engine/demand.ts`) scaled to 3.5M daily Chennai riders (~153,000 riders/day on the corridor).
- Simulation core (`src/engine/sim.ts`) with time-of-day traffic curves, physical dwell times ($T = 3 + 1.2b + 0.8a$), emergent bus bunching, EV battery discharge/charging, and sensor noise models.
- Samam controller (`src/engine/controller.ts`) with holding $\le 120$ s, short-turns, and flex pool dispatch strictly on fixed routes without access to ground truth.
- Web Worker (`src/worker/sim.worker.ts`) and live state store (`src/ui/store.ts`).
- Base UI shell (`src/ui/App.tsx`, `Console.tsx`, `styles.css`).
- 18 Vitest unit tests in `tests/engine.test.ts`.

---

## 3. What Was Implemented
1. **`src/ui/LeftPanel.tsx`**:
   - Interactive Scenario Switcher with all 5 operational profiles (Normal weekday, Heavy rain evening, Event surge, 20% sensors failing, Bus breakdown) and seed customizer.
   - Corridor summary card (lines, stops, fleet, EV ratio, Kilambakkam depot).
   - Bus Detail Inspector: real-time load meter, crowding band pill (E/S/T/C), EV battery state of charge & range, active sensor source, sensor health badge, "Block sensor" toggle, and "Trigger breakdown" button.
   - In-Cab Driver Console: phone-sized driver terminal with live holding countdown, route details, and status banners.
   - Stop Detail Inspector: displays waiting crowd comparison (Fixed vs Samam) and calling lines.
2. **`src/ui/ForecastView.tsx`**:
   - 60-minute segment-by-time interactive passenger load heatmap.
   - Pattern selector across all 14 corridor patterns.
   - View mode switcher: Actual Simulated, 30-Min Prediction, 60-Min Prediction, and Historical Profile.
   - Color ramp legend (0 to 80+ passengers per bus) and interactive hover tooltip displaying link stops, scheduled time, actual load, predicted loads, and MAE.
3. **`src/ui/ReportView.tsx`**:
   - End-of-run comparative performance report evaluating Baseline vs Samam across all 7 KPIs with delta calculations and operational verdicts.
   - Operational intervention breakdown: holds issued, short-turn trips, flex trips, and breakdown covers.
   - Sensor reliability and telemetry fault diagnostics (faults, detection rate, false alarms, detection delay).
   - Top congested stops breakdown.
   - Export tools: Download JSON, Export CSV, and Print / PDF view.
4. **`src/ui/MethodsView.tsx`**:
   - Comprehensive scientific documentation: data sources, GTFS validation, road snapping, agent demand modeling, dwell time physics, sensor error and ETM fallback mechanics, dispatch levers, citations, and honest limitations.
5. **20-Seed Batch Benchmark Experiment**:
   - Executed `scripts/batch.ts 20` across 20 independent seeds (101–120) for all 5 scenarios (300 simulation days total).
   - Generated `results/results.json`, `results/RESULTS.md`, and `src/data/batch-results.json`.
6. **Comprehensive Documentation**:
   - Authored complete `README.md` covering all 20 required sections with verified 20-seed benchmark figures and a 3-minute demo script.
   - Updated `DECISIONS.md` to reflect completed status.

---

## 4. Existing Files Modified
1. `src/map/mapHost.ts`: Fixed MapLibre dynamic import typing (`await import('maplibre-gl')`) and layer specification filter type.
2. `DECISIONS.md`: Updated implementation status section.

---

## 5. New Files Created
1. `ANTIGRAVITY_STARTING_STATE.md`: Initial independent audit report and verified starting state.
2. `src/ui/LeftPanel.tsx`: Scenario switcher, bus inspector, driver console, stop detail.
3. `src/ui/ForecastView.tsx`: 60-minute segment load prediction heatmap.
4. `src/ui/ReportView.tsx`: End-of-run comparative report and JSON/CSV exporter.
5. `src/ui/MethodsView.tsx`: Methodology and citation documentation.
6. `README.md`: Comprehensive project documentation.
7. `SAMAM_FINAL_COMPLETION_REPORT.md`: This final delivery report.

---

## 6. Bugs Fixed
1. **MapLibre GL Dynamic Import (`src/map/mapHost.ts:41`):**
   - *Error:* `Property 'default' does not exist on type 'typeof import(".../node_modules/maplibre-gl/dist/maplibre-gl")'`.
   - *Fix:* In MapLibre GL v6, `Map` is a named module export. Changed to `const maplibregl = await import('maplibre-gl'); const map = new maplibregl.Map(...)`.
2. **Layer Source-Layer Type Error (`src/map/mapHost.ts:64`):**
   - *Error:* `LayerSpecification` union typing error on background layer.
   - *Fix:* Cast layer array to allow flexible building inspection.
3. **Missing Module References (`src/ui/App.tsx:6-9`):**
   - *Error:* Four unresolved imports (`./ForecastView`, `./LeftPanel`, `./MethodsView`, `./ReportView`).
   - *Fix:* Authored all four missing components adhering to the existing design system.

---

## 7. Test Results
Command: `npm test` (`vitest run`)  
- **Test Files:** 1 passed (1)  
- **Tests:** **18 passed (18)** (100%)  
- **Duration:** 39.10s  
- **Verified Invariants:**
  - Geographic bounds inside Chennai region.
  - Passenger conservation across all 5 scenarios for both baseline and Samam arms (generated = waiting + onboard + arrived).
  - Strict vehicle capacity limits (80 diesel / 70 electric).
  - Common random numbers and determinism across seeds.
  - Holding bounds $\le 120$ s.
  - Automatic sensor fault detection and ETM ticket fallback.
  - Manual decision rejection altering operational outcomes.

---

## 8. TypeScript Compilation Result
Command: `npx tsc --noEmit`  
- **Result:** **0 errors**. Clean exit code 0.

---

## 9. Production Build Result
Command: `npm run build` (`tsc --noEmit && vite build`)  
- **Result:** **Built in 1.05s**.  
- **Distribution Bundle:** Successfully generated in `dist/` with optimized assets:
  - `dist/index.html` (1.02 kB)
  - `dist/assets/index-GYO36Y6G.js` (3,020 kB)
  - `dist/assets/sim.worker-CgVKSEtt.js` (524 kB)
  - `dist/assets/maplibre-gl-BJqcOGhp.js` (1,105 kB)

---

## 10. 20-Seed Experiment Results
Conducted via `npm run batch 20` across 20 independent seeds (101–120), totaling 300 simulation days:

### Normal Weekday Scenario (Mean ± SD across 20 seeds)
| Metric | Fixed Schedule | Samam (Holding Only) | Samam (All Levers) | Difference vs. Fixed | Better In |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Average Wait** | $4.20 \pm 0.03\text{ min}$ | $3.30 \pm 0.02\text{ min}$ | **$3.24 \pm 0.02\text{ min}$** | **-22.9%** ($-0.96 \pm 0.01\text{ min}$) | **20/20** |
| **90th Pct Wait** | $10.09 \pm 0.10\text{ min}$ | $7.64 \pm 0.08\text{ min}$ | **$7.55 \pm 0.09\text{ min}$** | **-25.2%** ($-2.54 \pm 0.06\text{ min}$) | **20/20** |
| **Left Behind (Events)** | $3,960 \pm 344$ | $1,679 \pm 204$ | **$1,197 \pm 139$** | **-69.8%** ($-2,763 \pm 142$) | **20/20** |
| **Peak Load (p99)** | $96.0 \pm 1.2\%$ | $85.8 \pm 1.5\%$ | **$82.0 \pm 1.6\%$** | **-14.6%** ($-14.0 \pm 0.7\%$) | **20/20** |
| **Crush Departures** | $1.65 \pm 0.09\%$ | $1.00 \pm 0.07\%$ | **$0.82 \pm 0.06\%$** | **-50.0%** ($-0.82 \pm 0.03\%$) | **20/20** |
| **Bunching Events** | $1,359 \pm 68$ | $407 \pm 23$ | **$476 \pm 24$** | **-65.0%** ($-884 \pm 29$) | **20/20** |
| **Bus-Kilometres** | $72,145 \pm 3\text{ km}$ | $72,141 \pm 3\text{ km}$ | $73,158 \pm 74\text{ km}$ | +1.4% ($+1,013 \pm 34\text{ km}$) | 0/20 |
| **Average Journey Time** | $18.74 \pm 0.07\text{ min}$ | $17.90 \pm 0.05\text{ min}$ | **$17.79 \pm 0.05\text{ min}$** | **-5.1%** ($-0.96 \pm 0.02\text{ min}$) | **20/20** |

*Actions Executed per Day (Mean):* 2,621 holds, 31.9 short-turn trips, 6.2 flex trips, 0.0 covers.  
*Sensor Faults:* 98 of 101 faults detected (97%) with a median detection delay of 2.7 minutes.

---

## 11. Live Browser Verification Results
Verified live via browser automation at `http://localhost:5173/`:
- **Initial Load:** Clean page load with zero uncaught exceptions.
- **Map & deck.gl Overlays:** Corridor route lines, animated moving buses, and crowd-sized stop circles render cleanly. Buses are labeled with crowding bands (Blue, Green, Amber, Red) and letter cues (E, S, T, C). Bunched buses are highlighted with glowing pink rings.
- **Fixed vs. Samam Toggle:** Switches simulation views instantaneously.
- **Time Controls:** Play/pause and speed buttons (1x to 120x) function with real-time clock advancement.
- **Dispatcher Console:** Feeds live holding and extra trip recommendations with plain-English rationales; Auto and Manual modes function as specified.
- **Left Panel & Details:** Scenario switching triggers deterministic reloads; clicking buses displays load factors, EV battery telemetry, and manual sensor blocking; Driver Console displays in-cab holding countdowns.
- **Forecast View:** Displays 60-minute segment load heatmap with pattern selector and hover tooltips.
- **Report View:** Displays complete comparative performance tables, intervention counts, and working JSON/CSV exports.
- **Methods View:** Formats all scientific documentation, formulas, and calibration tables cleanly.
- **MapLibre Fallback:** Verified via `?basemap=maplibre`—gracefully switches to MapLibre dark basemap with the status notice displayed.

---

## 12. Remaining Limitations
- **Simulated Passenger Agents:** While route topology, schedules, and stop locations are 100% genuine MTC data, passenger origin-destination pairs and arrivals are generated via gravity and Poisson modeling.
- **Single Corridor Scope:** The prototype focuses on the GST Road trunk corridor (7 lines, 339 stops). Network-wide fleet repositioning across all 4,206 Chennai buses is beyond prototype scope.
- **Fixed Routes:** Samam never detours buses off their designated routes; all holding and extra trips occur on established GTFS route patterns.

---

## 13. Exact Commands to Launch the Application

```bash
# 1. Install dependencies (if not already installed)
npm install

# 2. Run unit tests
npm test

# 3. Build static production site
npm run build

# 4. Start the development server
npm run dev
```

---

## 14. Local Development URL
- **Local Application:** `http://localhost:5173/`
- **MapLibre Fallback Mode:** `http://localhost:5173/?basemap=maplibre`
