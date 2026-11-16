# DECISIONS

Choices made where the brief was ambiguous. Status at the bottom says what is built and what is not.

## Data
- **Feed passed validation.** 5,580 MTC stops, all inside the Chennai box (lat 12.3–13.7, lon 79.5–80.5), no New York
  coordinates, 47,047 MTC trips with usable stop sequences and times. Report: `data/validation-report.json`.
- **The feed has no MTC shapes** (its 13 shapes are metro only). Road geometry was snapped once at preprocessing with the
  Mapbox Directions API and bundled in `src/data/corridor.json`. Nothing calls Mapbox routing at runtime. Responses are
  cached in `data/directions-cache/`. No leg needed a straight-line fallback; a few stops that snapped to the wrong
  carriageway were dropped as waypoints and projected onto the line.
- **A "line" is a route short-name family** (first token of `route_short_name`, so `91` and `91 R` are one line),
  represented by its most frequent stop pattern in each direction. Minor variants are not simulated.
- **Corridor rule:** the busiest directed stop-to-stop segment in the feed (Vandalur Zoo → Vandalur Gate, 2,739 trips/day),
  then the 7 lines with the most scheduled trips through it: 91, 500, 70V, 104C, 66P, 21G, 18A. Line 95X was skipped
  because its two directions differ by 46% in trips, which would need unscheduled deadheading.
- **Only weekday service (`MTC-Regular`) between 04:00 and 24:00 is simulated.** 2,171 trips/day, 4.62% of the feed.
- **GTFS run times are taken as the timetable.** They are fast (35–45 km/h on GST Road). Simulated traffic is calibrated
  so the all-day mean run time matches them (actual/scheduled 0.99), with peaks slower.

## Simulation
- **Demand:** 3.5 million/day × the corridor's share of scheduled trips ≈ 153,000 riders/day. Stop attractiveness is
  (trips/day calling at the stop in the whole feed)^0.8; trip length decays with a 12 km scale. No transfers: each rider
  travels between two stops on one pattern and boards the first bus that serves the destination.
- **Fleet is derived from the timetable** by first-in-first-out blocking (231 buses), not invented. 18% are electric,
  matching 755/4,206.
- **Flex pool = spare buses** (8% of the scheduled fleet = 18), parked at Kilambakkam, the terminus most patterns share.
  In the fixed-schedule arm they stay parked. This means Samam uses more bus-km, which is why bus-km is a KPI and why the
  batch has a holding-only arm.
- **Short-turn and flex trips both use pool buses.** A short-turn runs from the depot to a turn stop and back; a flex
  trip runs the full pattern and back. Buses stay on their route throughout.
- **Breakdowns:** riders get off and wait at that stop. Samam sends a pool bus to take over the block at once; the
  fixed-schedule arm does the same after an assumed 45-minute manual response.
- **"Left behind" counts events**, so a rider refused by two buses counts twice. Unique riders are tracked too.
- **"Peak load" is the 99th percentile** of load factor at stop departures, because the maximum is capacity in both arms.
- **Average journey (wait + ride) was added as a seventh KPI**, because holding delays riders already on board.
- **Common random numbers:** traffic, passengers and tickets are hashed from the seed, so both arms see the same world.

## Controller
- **Forecast method:** time-of-day profile from 12 simulated fixed-schedule days, plus a 3-term ridge regression
  correction (link residual, upstream residual, pattern demand ratio) fitted on 16 simulated days. Held-out error:
  5.37 → 4.64 riders/bus at 10 minutes, 5.45 → 5.39 at 60 minutes. The live correction adds little beyond 20 minutes.
- **Holding** is two-way headway based, every 4th stop and at the terminus, 20–120 s, and only when the predicted
  waiting saved exceeds the delay to riders on board.
- **Manual mode:** a pending hold lapses when its bus leaves the stop; short-turn and flex recommendations stay open
  for 5 minutes.

## App
- **Mapbox Standard style, night preset, deck.gl overlaid** (not interleaved) so buses are never hidden by buildings.
- **One map instance**, kept on `window` across hot reloads; Baseline vs Samam is a toggle. `?basemap=maplibre` or
  `?basemap=plain` skips Mapbox to save map loads while testing.
- **Crowding colours** are blue/green/amber/red plus a letter (E/S/T/C) and marker size, so colour is never the only cue.
- **Calibration sources** are cited as supplied in the brief; I did not verify them independently.

## Implementation Status
- **Initial pause (usage limit):** Built headless engine, data pipeline, and basic shell; 4 UI components, 20-seed batch run, and README were pending.
- **Resumed & Completed:**
  - Fixed MapLibre dynamic import in `src/map/mapHost.ts`.
  - Implemented `LeftPanel.tsx` (Scenarios, bus inspector with sensor blocking and breakdown trigger, driver phone terminal, and stop detail).
  - Implemented `ForecastView.tsx` (60-minute segment-by-time load heatmap with horizon filters and hover tooltips).
  - Implemented `ReportView.tsx` (End-of-run comparative performance tables, intervention breakdown, sensor reliability diagnostics, JSON/CSV exports, and print layout).
  - Implemented `MethodsView.tsx` (Comprehensive modeling transparency, GTFS validation details, calibration citations, EV battery physics, and non-deep-learning forecaster documentation).
  - Executed full 20-seed batch benchmark across all 5 scenarios (seeds 101–120); verified paired statistical improvements.
  - Authored comprehensive `README.md` with cited 20-seed figures and demo script.
  - Successfully validated static production build (`npm run build`) and test suite (18/18 passing).
