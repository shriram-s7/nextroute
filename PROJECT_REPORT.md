# NextRoute: Technical Project & System Architecture Report
**Adaptive Dispatch, Headway Regularity, and Real-Time Corridor Control for Chennai Buses**

---

## 1. Executive Summary

Public bus transit systems in rapidly growing metropolitan regions face severe service degradation due to **bus bunching** and **headway instability**. In high-frequency transit networks like Chennai's Metropolitan Transport Corporation (MTC), buses dispatched at uniform timetable intervals inevitably cluster into closely spaced convoys. The leading bus experiences compounding delays as it encounters growing passenger queues at downstream stops, while trailing buses skip boardings, catch up, and run virtually empty directly behind the leader. This operational failure causes extreme passenger wait times, unpredictable headways, and high peak crush loads, while leaving substantial fleet capacity underutilized.

**NextRoute** is an intelligent, real-time closed-loop adaptive dispatch system developed specifically for high-density Indian urban transit corridors. Operating on Chennai's busiest transit artery—the **Grand Southern Trunk (GST) Road corridor**—NextRoute integrates real-world General Transit Feed Specification (GTFS) network topography with a high-fidelity discrete-event simulation engine, an edge-computed rolling-horizon passenger demand forecaster, an automated IoT telemetry fault-detection watchdog, and a three-lever operational controller:

1. **Headway Regularity Holding:** Targeted delays (20–120 seconds) applied to lightly loaded lead vehicles at designated timing stops to restore balanced spacing, costing zero additional fleet resources.
2. **Dynamic Short-Turning:** Early turning of buses ahead of low-density terminal segments to redeploy capacity back into high-demand bottleneck links.
3. **Dynamic Flex Fleet Pool Insertion:** Real-time injection of an 8% agile standby reserve pool stationed at major multimodal depots (Kilambakkam) during demand surges, severe rain, or mechanical breakdowns.

```
                              ┌────────────────────────┐
                              │  Real-Time Sensor Bus  │
                              │   (IoT + GPS + ETM)    │
                              └───────────┬────────────┘
                                          │
                                          ▼
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │                          NextRoute Decision Engine                          │
   │                                                                             │
   │   1. Headway Regularity Holding:    Even out bus spacing at key stops       │
   │   2. Dynamic Short-Turning:         Turn early before empty tail segments   │
   │   3. Dynamic Flex Fleet Insertion:  Inject standby buses during surges      │
   └──────────────────────────────────────┬──────────────────────────────────────┘
                                          │
                                          ▼
                      Slashing Wait Times by 23% & Left-Behinds by 70%
```

### Key Quantitative Achievements
Across a rigorous 20-seed Monte Carlo experimental suite (300 full simulated operating days) comparing NextRoute against Chennai's static timetable baseline under identical passenger arrivals and traffic conditions:
- **Average Passenger Wait Time:** Reduced by **22.9%** ($4.20 \to 3.24\text{ min}$, $p < 0.001$).
- **90th Percentile (P90) Wait Time:** Reduced by **25.2%** ($10.09 \to 7.55\text{ min}$).
- **Left-Behind Passenger Events:** Slashed by **69.8%** ($3,960 \to 1,197\text{ events/day}$).
- **Peak Passenger Load (P99):** Reduced from **96.0% to 82.0%** of vehicle capacity.
- **Bus Bunching Events:** Plunged by **65.0%** ($1,359 \to 476\text{ events/day}$).
- **Operational Cost Overhead:** Required only a **+1.4%** increase in total corridor bus-kilometres, demonstrating extreme capital efficiency.

---

## 2. Corridor Engineering & GTFS Data Ingestion

### 2.1 GTFS Feed Validation & Geographic Bounds
NextRoute ingests the official Chennai unified GTFS open-data feed (`data/chennai-unified-gtfs.zip`). The ingestion and validation pipeline (`scripts/gtfs-validate.mjs`) verified:
- **Spatial Boundaries:** 5,580 MTC bus stops validated inside the Chennai metropolitan bounding box ($\text{Latitude: } 12.30^\circ\text{ to } 13.70^\circ\text{ N}, \text{ Longitude: } 79.50^\circ\text{ to } 80.50^\circ\text{ E}$).
- **Trip Corpus:** 47,047 scheduled MTC trips with valid stop sequences, arrival times, and departure schedules.
- **Service Filtering:** Focused on weekday regular transit schedules (`MTC-Regular`) between 04:00 and 24:00 IST (18 operational hours per day).

### 2.2 Corridor Selection: The GST Road Artery
Rather than evaluating an arbitrary synthetic network, NextRoute targets the single most heavily loaded transit corridor in the entire Chennai bus network. By scanning all directed stop-to-stop links across 47,047 trips, the algorithm identified the highest-frequency transit segment in the metropolitan area:
- **Busiest Link:** `Vandalur Zoo` $\to$ `Vandalur Gate` (2,739 scheduled bus trips per day).
- **Trunk Lines:** The 7 MTC route families carrying the highest daily trip volume through this bottleneck were selected:
  1. **Line 91:** Tambaram $\leftrightarrow$ Thiruvanmiyur
  2. **Line 500:** Chengalpattu $\leftrightarrow$ Tambaram / T. Nagar
  3. **Line 70V:** Guduvanchery $\leftrightarrow$ Koyambedu (CMBT)
  4. **Line 104C:** Tambaram $\leftrightarrow$ Central Railway Station
  5. **Line 66P:** Kilambakkam (KCBT) $\leftrightarrow$ Broadway
  6. **Line 21G:** Vandalur $\leftrightarrow$ Broadway
  7. **Line 18A:** Tambaram $\leftrightarrow$ Broadway / High Court
- **Corridor Dimensions:** 339 physical bus stops, 14 directed route patterns (inbound and outbound variants), and 2,171 scheduled trips per weekday (representing 4.62% of all MTC bus operations citywide).

```
[Broadway / CMBT / Central] (North / Central Hubs)
          ▲
          │  Corridor Trunk: 7 Lines Overlapped (High Frequency)
          ▼
    [Guindy / Saidapet]
          ▲
          │
          ▼
   [Tambaram Sanatorium]
          ▲
          │  Bottleneck Link (2,739 trips/day)
          ▼
[Vandalur Zoo ↔ Vandalur Gate]
          ▲
          │
          ▼
[Kilambakkam Bus Terminus (KCBT)] (Southern Hub & Flex Depot)
```

### 2.3 Road Network Snapping & Geometry
Because public GTFS feeds in Indian transit agencies frequently lack micro-level road shape definitions (GTFS `shapes.txt` contained only Chennai Metro rail trajectories), NextRoute preprocessed all stop-to-stop paths using the Mapbox Directions API.
- All 339 stops and 14 pattern trajectories were snapped to actual dual-carriageway road geometries.
- Stop coordinates that snapped onto reverse carriageways were projected onto the correct directional line.
- The resulting road vector geometries, distances, and elevation profiles were compiled into `src/data/corridor.json` (124 KB), completely decoupling runtime execution from external network requests.

---

## 3. Passenger Demand & Behavioral Modeling

### 3.1 Citywide Calibration & Corridor Volume
To ensure empirical realism, demand volume is anchored to official Chennai transport benchmarks:
- **Macro Calibration:** Chennai MTC carries approximately **3.50 million passengers per day** across a fleet of 4,206 buses (755 electric, 3,451 diesel).
- **Corridor Share:** The 7 GST Road trunk lines represent 4.62% of total citywide scheduled trips, calibrating baseline corridor demand to **$\approx 153,000$ passenger trips per day**.

### 3.2 Spatial Gravity Distribution
For any pair of stops $i$ (origin) and $j$ (destination) on a route pattern, the boarding attraction weight $W_{ij}$ is computed via a modified gravity formulation:
$$W_{ij} = \left( T_i \right)^{\alpha} \cdot \left( T_j \right)^{\alpha} \cdot \exp\left( -\frac{d_{ij}}{d_{\text{decay}}} \right) \cdot \Phi(d_{ij})$$
Where:
- $T_i, T_j$: The total scheduled bus departures calling at stop $i$ and $j$ across the entire citywide GTFS feed, representing physical node connectivity.
- $\alpha = 0.80$: Attractiveness elasticity exponent, capturing sub-linear scaling of transit activity.
- $d_{ij}$: Network travel distance between origin and destination along the route.
- $d_{\text{decay}} = 12,000\text{ meters (12 km)}$: Spatial decay parameter calibrated to suburban-to-urban commuting lengths along GST Road.
- $\Phi(d_{ij})$: Short-trip penalty function that discounts trips shorter than 700 meters by 85% ($\Phi = 0.15$ for $d_{ij} < 700\text{m}$, $\Phi = 1.0$ otherwise), reflecting pedestrian walking substitution.

### 3.3 Diurnal Temporal Profiling
Passenger arrivals at stop queues follow an inhomogeneous Poisson process. The arrival rate $\lambda_p(t)$ for pattern $p$ at time of day $t$ (in hours $h = t / 3600$) is modulated by directional morning and evening commuting peaks:
$$\lambda_p(t) = \text{ramp}(h) \cdot \left[ 0.32 + \omega_{\text{am}} \cdot \exp\left( -0.5 \left( \frac{h - 8.90}{1.15} \right)^2 \right) + \omega_{\text{pm}} \cdot \exp\left( -0.5 \left( \frac{h - 18.20}{1.50} \right)^2 \right) \right]$$
Where:
- **Inbound Patterns (towards Central Chennai):** $\omega_{\text{am}} = 1.25$, $\omega_{\text{pm}} = 0.85$ (heavy morning peak centered at 08:54 IST).
- **Outbound Patterns (towards Tambaram/Kilambakkam):** $\omega_{\text{am}} = 0.85$, $\omega_{\text{pm}} = 1.25$ (heavy evening peak centered at 18:12 IST).
- $\text{ramp}(h)$: Smooth activation curve ramping service up from 04:30 to 06:30 and winding down after 21:00.

### 3.4 Boarding, Alighting, and Vehicle Dwell Physics
When bus $b$ arrives at stop $k$, the dwell time $T_{\text{dwell}}$ is determined by physical passenger movement dynamics:
$$T_{\text{dwell}} = T_{\text{base}} + \tau_{\text{alight}} \cdot n_{\text{alight}} + \tau_{\text{board}} \cdot n_{\text{board}} + T_{\text{congestion}}$$
- $T_{\text{base}} = 5.0\text{ s}$: Door actuation and hydraulic brake clearance.
- $\tau_{\text{alight}} = 1.0\text{ s/pax}$: Passenger egress speed through rear exit doors.
- $\tau_{\text{board}} = 1.9\text{ s/pax}$: Passenger ingress speed through front entrance doors with fare validation.
- $T_{\text{congestion}} = 0.6 \cdot n_{\text{board}}$: Non-linear boarding friction applied when the bus load exceeds 60% of total rated capacity.

### 3.5 Vehicle Capacity & Left-Behind Passengers
Two vehicle configurations are modeled, matching MTC's operational fleet:
- **Diesel Bus (Standard):** 40 seats, total crush capacity $C = 80$ passengers.
- **Electric Bus (Low-Floor):** 35 seats, total crush capacity $C = 70$ passengers.

When the instantaneous onboard load reaches capacity $C$, no further passengers can board. Waiting riders remain in the stop queue. If a passenger is passed by a full bus, a "Left-Behind" event is logged. If passed by multiple full buses, each refusal is logged independently, accurately measuring passenger frustration and platform congestion.

---

## 4. Vehicle Dynamics, Traffic Fields & Electrification Physics

### 4.1 Correlated Spatial-Temporal Traffic Fields
Traffic delays along GST Road do not affect vehicles independently; congestion is spatially correlated across road segments.
- The simulator generates a shared log-normal traffic field updated in 15-minute intervals ($B = 900\text{ s}$) with link volatility $\sigma_{\text{field}} = 0.12$.
- Individual driver behavior incorporates an orthogonal variability factor with $\sigma_{\text{driver}} = 0.06$.
- Diurnal congestion multiplier $M(t)$:
  $$M(t) = 1.0 + \Delta_{\text{night}} + 0.28 \cdot \exp\left( -0.5 \left( \frac{h - 9.20}{1.10} \right)^2 \right) + 0.36 \cdot \exp\left( -0.5 \left( \frac{h - 18.50}{1.40} \right)^2 \right)$$
  Yielding peak evening travel time penalties of $+36\%$ during peak rush hour.

### 4.2 Electric Bus (EV) Battery & Thermal Physics
Electric buses comprise 18% of the corridor fleet (matching MTC's 755 / 4,206 ratio). Electric vehicles obey battery energy dynamics:
- **Pack Capacity:** 230 kWh Lithium Iron Phosphate (LFP) traction battery.
- **Traction Energy Consumption:** $E_{\text{traction}} = 1.0\text{ kWh/km} \times \left(1.0 + 0.25 \cdot \frac{\text{Load}}{C}\right)$, capturing mass-induced rolling resistance.
- **Auxiliary HVAC Load:** Continuous $3.0\text{ kW}$ power draw for Chennai tropical climate cabin air-conditioning.
- **Fast Charging Infrastructure:** 180 kW DC fast chargers located at the Kilambakkam depot.
- **Operational SoC Constraints:**
  - Mandatory charging triggered if State of Charge (SoC) drops below 15% at a terminus.
  - Return to service allowed only once SoC reaches 50%.
  - Target operational cap set to 92% to preserve cell longevity.
  - **Flex Dispatch Gate:** The NextRoute controller prohibits assigning an electric bus to an extra short-turn or flex run if its projected terminal return SoC would fall below 20%.

---

## 5. Telemetry, Sensor Fusion & Fault Watchdog

In real-world transit environments, controllers cannot access simulation ground truth. NextRoute operates strictly through sensor observation channels subject to hardware noise, environmental occlusion, and field failures.

```
                  ┌──────────────────────────────────────────────┐
                  │          Real-Time Bus Data Streams          │
                  └──────┬───────────────────────┬───────────────┘
                         │                       │
             ┌───────────▼──────────┐ ┌──────────▼──────────────┐
             │ Door Sensors & CCTV  │ │ Electronic Ticket (ETM) │
             │  (Noisy, Drifting)   │ │   (Clean Fare Baseline) │
             └───────────┬──────────┘ └──────────┬──────────────┘
                         │                       │
                         └───────────┬───────────┘
                                     │
                                     ▼
                      ┌─────────────────────────────┐
                      │    Sensor Fault Watchdog    │
                      │  (Residual Drift Detection) │
                      └──────────────┬──────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
             [Sensor Healthy]                [Anomaly Detected]
             High-Precision Live Load        Instant Failover to ETM
             Estimation (APC + Camera)       Ticket Baseline Curves
```

### 5.1 Telemetry Sensor Noise Modeling
1. **Automated Passenger Counting (APC) Door Sensors:**
   - Standard boarding/alighting count error: $\sigma = 5.0\%$.
   - Under crush loads ($>85\%$ capacity): additional error variance $\sigma_{\text{crush}} = 14.0\%$, with an 8.0% miss rate due to severe passenger crowding at doors.
2. **Onboard CCTV Occupancy Estimators:**
   - Optical occupancy estimation includes a camera calibration bias ($\sigma_{\text{bias}} = 4.0\%$) and an occlusion undercount factor of up to 12.0% during crush conditions.
3. **Electronic Ticketing Machine (ETM) Transactions:**
   - Digital ticketing records account for 94.0% of boardings (6.0% passholders/cash fare evasion), providing a reliable lower-bound floor.

### 5.2 Sensor Fault Detection Watchdog
Sensors in Indian operating conditions suffer from optical lens smudging, wiring disconnections, and physical tamper events.
- **Baseline Failure Rate:** Under normal operations, 2.0% of buses suffer telemetry sensor failure during their shift. Under the stress-test scenario, 20.0% of sensors fail.
- **Detection Algorithm:** The watchdog computes the rolling cumulative divergence between the door counter integral and the expected ETM ticketing rate. When the cumulative discrepancy exceeds $3.5\sigma$ over 3 consecutive stops, the watchdog flags a hardware fault.
- **Failover Mechanics:** The controller automatically decouples the faulty APC channel and falls back to a Bayesian historical boarding curve conditioned on ETM transaction volumes.
- **Empirical Watchdog Benchmark:** Across 20 simulated days with 101 hardware faults, the watchdog detected **98 out of 101 faults (97.0% recall)** with a median detection latency of **2.7 minutes**, while triggering only 19 false alarms across 4,620 bus operating hours. Under 20% systemic failures, it detected **963 of 979 faults (98.4%)**.

---

## 6. Rolling-Horizon Passenger Load Forecaster

To act proactively rather than reactively, NextRoute incorporates a non-deep-learning, edge-computed passenger load forecaster operating across a **60-minute look-ahead horizon** discretized into 10-minute bins ($h \in \{1, 2, 3, 4, 5, 6\}$).

### 6.1 Mathematical Formulation
The predicted passenger load $\widehat{L}_{p,k}(t+h)$ on link $k$ of pattern $p$ at future time $t + h \cdot \Delta t$ is formulated as an autoregressive ridge regression expansion around the diurnal baseline:
$$\widehat{L}_{p,k}(t+h) = \bar{L}_{p,k}(t+h) + a_h \cdot \Delta_{p,k}(t) + c_h \cdot \Delta_{p, k - \text{step}_h}(t) + g_h \cdot \left( \Gamma_p(t) - 1.0 \right) \cdot \bar{L}_{p,k}(t+h)$$
Where:
- $\bar{L}_{p,k}(t+h)$: Diurnal historical mean load for link $k$ at time $t+h$, pre-trained over 12 baseline days.
- $\Delta_{p,k}(t) = \widetilde{L}_{p,k}(t) - \bar{L}_{p,k}(t)$: Instantaneous load residual observed at link $k$ by the most recent bus.
- $\Delta_{p, k - \text{step}_h}(t)$: Upstream spatial residual measured $\text{step}_h$ stops behind link $k$, capturing shockwaves propagating down the corridor.
- $\Gamma_p(t) = \frac{\sum_{\tau} \widetilde{L}_{p}(\tau) \cdot e^{-(\Delta \tau / 1800)}}{\sum_{\tau} \bar{L}_{p}(\tau) \cdot e^{-(\Delta \tau / 1800)}}$: Exponentially decayed corridor demand ratio, indicating whether overall corridor demand is running above or below historical norms.
- $a_h, c_h, g_h$: Regularized regression coefficients optimized via Ridge regression ($\lambda = 10.0$) on 16 held-out simulated days.

### 6.2 Forecast Performance on Held-Out Test Days
Evaluated on completely held-out simulated operating days, the model demonstrates high stability without the compute overhead or hallucination risks of deep recurrent networks:

| Look-Ahead Horizon | Historical Profile MAE | NextRoute Live Model MAE | Error Reduction |
| :---: | :---: | :---: | :---: |
| **10 minutes ($h=1$)** | 5.38 pax/bus | **4.64 pax/bus** | **−13.8%** |
| **20 minutes ($h=2$)** | 5.38 pax/bus | **4.92 pax/bus** | **−8.6%** |
| **30 minutes ($h=3$)** | 5.39 pax/bus | **5.16 pax/bus** | **−4.3%** |
| **40 minutes ($h=4$)** | 5.41 pax/bus | **5.31 pax/bus** | **−1.9%** |
| **50 minutes ($h=5$)** | 5.43 pax/bus | **5.38 pax/bus** | **−0.9%** |
| **60 minutes ($h=6$)** | 5.46 pax/bus | **5.41 pax/bus** | **−0.9%** |

*Operational Insight:* Real-time telemetry residuals yield dramatic accuracy improvements in the immediate 10–20 minute tactical dispatch window, while the diurnal profile reliably anchors longer-range 60-minute fleet positioning.

---

## 7. The Three-Lever Adaptive Control Architecture

Every 300 seconds (5 minutes), the NextRoute controller executes an optimization cycle. Operating without ground-truth visibility, it evaluates candidate interventions using only telemetry observations and forecast distributions.

```
                    ┌────────────────────────────────────────┐
                    │     300-Second Optimization Cycle      │
                    └───────────────────┬────────────────────┘
                                        │
         ┌──────────────────────────────┼──────────────────────────────┐
         │                              │                              │
         ▼                              ▼                              ▼
  [Lever 1: Holding]           [Lever 2: Short-Turn]          [Lever 3: Flex Pool]
Headway imbalance > 90s        Core bottleneck load > 70%     Unrelieved corridor surge
Hold = min(120s, 0.35 * imb)   Turn bus before empty tail     Inject Kilambakkam spare
Net benefit > 120 pax·s        Redeploy to reverse trunk      Relief > 6 pax/bus-km
```

### 7.1 Lever 1: Dynamic Headway Regularity Holding
Holding prevents bus bunching by slowing down a leading bus that has pulled too far ahead of its follower.
- **Timing Point Constraint:** To prevent passenger frustration, holding is strictly restricted to every 4th stop along the pattern and at terminal departures.
- **Headway Tracking:** For bus $b$ arriving at timing stop $j$ at estimated time $\text{ETA}$:
  - Forward headway to lead bus: $h_f = \text{ETA} - t_{\text{lead}}$.
  - Backward headway from following bus: $h_b = t_{\text{follower}} - \text{ETA}$.
  - Headway imbalance: $\Delta h = h_b - h_f$.
- **Trigger Condition:** Imbalance $\Delta h \ge 90\text{ seconds}$.
- **Holding Duration:**
  $$x = \text{round}_{10}\left( \min\left( 120\text{ s}, 0.35 \cdot \Delta h \right) \right)$$
  Subject to a minimum actionable hold of $x \ge 20\text{ seconds}$.
- **Passenger Cost-Benefit Objective:** A hold is approved if and only if the downstream waiting time saved exceeds the onboard delay penalty:
  $$\Delta \text{Benefit} = \lambda_{\text{downstream}} \cdot x \cdot (\Delta h - x) - 0.5 \cdot \text{Load}_{\text{onboard}} \cdot x \ge 120\text{ passenger-seconds}$$
  Where on-board passenger delay is weighted at half the penalty of platform waiting time ($0.5$).

### 7.2 Lever 2: Dynamic Short-Turning
During peak commuting hours, passenger demand along GST Road is heavily concentrated between Tambaram and Guindy, while outer suburban terminal loops experience minimal boardings.
- The controller evaluates buses reaching intermediate crossover points.
- If the downstream outer link forecast shows load factor $< 25\%$ while the opposing peak direction shows load factor $> 75\%$, the controller instructs the bus to terminate early at designated turnaround depots.
- This immediately repositions empty capacity into the opposing crush direction, eliminating up to 45 minutes of unproductive deadheading.

### 7.3 Lever 3: Dynamic Flex Fleet Pool Insertion
NextRoute allocates an 8% agile reserve pool (18 buses) stationed at the Kilambakkam multimodal terminus.
- In the fixed-schedule baseline, these buses sit idle in the depot.
- In NextRoute, when the 60-minute link load forecast identifies an overcrowding spike ($> 70\%$ capacity) that cannot be mitigated by holding or short-turning, a standby bus is dispatched.
- **Dispatch Gate:** Requires a projected relief ratio of at least **6.0 overcrowded passenger-trips relieved per extra bus-kilometre**, ensuring fiscal responsibility.
- A 10-minute cooldown timer is enforced per pattern to prevent fleet over-commitment.

---

## 8. Software Architecture & Zero-Server Deployment

NextRoute is engineered as a modern, zero-server browser application capable of running high-throughput discrete-event simulations directly on client hardware.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        NextRoute UI (Main Thread)                      │
│                                                                        │
│  React 19 + TypeScript + Vite + Zustand Store                          │
│  ┌───────────────────────┐  ┌───────────────────────────────────────┐  │
│  │ 3D Mapbox / MapLibre  │  │ Analytical Control Panels             │  │
│  │ deck.gl WebGL Layers  │  │ Console · Forecast · Report · Methods │  │
│  └───────────────────────┘  └───────────────────────────────────────┘  │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ PostMessage (Delta State Buffers)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Dedicated Web Worker (sim.worker.ts)                 │
│                                                                        │
│  Headless Discrete-Event Engine (Multi-Arm Lockstep)                   │
│  ┌───────────────────────┐  ┌───────────────────────────────────────┐  │
│  │ Baseline Simulator    │  │ NextRoute Simulator                   │  │
│  │ (Fixed Schedule Arm)  │  │ (Adaptive 3-Lever Controller Arm)     │  │
│  └───────────────────────┘  └───────────────────────────────────────┘  │
│                                   │ Shared PRNG Seed (Common Random)   │
│                                   ▼                                    │
│                    Discrete Event Priority Queue                       │
└────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Dual-Arm Lockstep Simulation Core
The simulation runs inside a dedicated HTML5 Web Worker (`src/worker/sim.worker.ts`). Both the Fixed Schedule arm and the NextRoute arm advance concurrently across identical pseudo-random number sequences (Mulberry32 PRNG). Both arms experience the exact same passenger arrivals, identical traffic friction, and identical breakdown events, isolating the true causal effect of the dispatch controller.

### 8.2 Rendering & UI Layer
- **Hardware-Accelerated WebGL Rendering:** Built with `@deck.gl/core`, `@deck.gl/layers`, and `@deck.gl/mapbox` / `maplibre-gl`.
- **Adaptive Fallback Pipeline:**
  1. Primary: Mapbox GL JS with Mapbox Standard 3D night preset.
  2. Fallback: MapLibre GL with free CARTO Dark Matter vector basemap.
  3. Safe Canvas: Plain dark canvas if external tile servers are unreachable.
- **Operational Cockpits:**
  - **Live 3D Map:** Visualizes 231 active buses colored by crowding bands (`E`mpty blue, `S`eated green, `T`standing amber, `C`rush red) with glowing pink bunching indicators.
  - **Dispatcher Cockpit:** Offers Autonomous and Manual approval modes for holding and extra trips.
  - **In-Cab Driver Terminal:** Phone-sized digital display simulating driver countdown instructions.
  - **Forecast Matrix:** 60-minute interactive load heatmap across all 14 corridor patterns.
  - **Run Report & Analytics:** Comparative KPI tables, intervention logs, sensor diagnostics, and one-click JSON/CSV dataset export.

---

## 9. Comprehensive Benchmark Results & Experimental Evaluation

The system was evaluated using `scripts/batch.ts` across **20 independent random seeds** (seeds 101–120), simulating full 18-hour operating days (04:00 to 22:00) across **5 distinct operational scenarios** (totaling 300 simulated days).

### 9.1 Scenario 1: Normal Weekday Operations
*Typical Chennai weekday demand and diurnal traffic congestion.*

| Performance Metric | Fixed Schedule Baseline | NextRoute (Holding Only) | NextRoute (All 3 Levers) | Absolute Change | Percentage Change (95% CI) | Statistical Win Rate |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Average Wait Time** | $4.20 \pm 0.03\text{ min}$ | $3.30 \pm 0.02\text{ min}$ | **$3.24 \pm 0.02\text{ min}$** | $-0.96\text{ min}$ | **−22.9%** [−23.1%, −22.7%] | **20 / 20 seeds (100%)** |
| **90th Pct Wait Time** | $10.09 \pm 0.10\text{ min}$ | $7.64 \pm 0.08\text{ min}$ | **$7.55 \pm 0.09\text{ min}$** | $-2.54\text{ min}$ | **−25.2%** [−25.8%, −24.6%] | **20 / 20 seeds (100%)** |
| **Left-Behind Events** | $3,960 \pm 344$ | $1,679 \pm 204$ | **$1,197 \pm 139$** | $-2,763$ | **−69.8%** [−73.4%, −66.2%] | **20 / 20 seeds (100%)** |
| **Peak Load (P99)** | $96.0 \pm 1.2\%$ | $85.8 \pm 1.5\%$ | **$82.0 \pm 1.6\%$** | $-14.0\%$ | **−14.6%** [−15.3%, −13.9%] | **20 / 20 seeds (100%)** |
| **Crush Departures** | $1.65 \pm 0.09\%$ | $1.00 \pm 0.07\%$ | **$0.82 \pm 0.06\%$** | $-0.83\%$ | **−50.0%** [−51.8%, −48.2%] | **20 / 20 seeds (100%)** |
| **Bunching Events** | $1,359 \pm 68$ | **$407 \pm 23$** | $476 \pm 24$ | $-884$ | **−65.0%** [−67.1%, −62.9%] | **20 / 20 seeds (100%)** |
| **Corridor Bus-Km** | $72,145 \pm 3\text{ km}$ | $72,141 \pm 3\text{ km}$ | $73,158 \pm 74\text{ km}$ | $+1,013\text{ km}$ | **+1.4%** [+1.3%, +1.5%] | *Cost measure* |
| **Average Journey Time** | $18.74 \pm 0.07\text{ min}$ | $17.90 \pm 0.05\text{ min}$ | **$17.79 \pm 0.05\text{ min}$** | $-0.96\text{ min}$ | **−5.1%** [−5.2%, −5.0%] | **20 / 20 seeds (100%)** |

*Operational Analysis:*
1. **The Power of Holding:** Headway holding alone delivers **93.7% of the total wait time reduction** ($4.20 \to 3.30\text{ min}$) while utilizing **zero additional bus-kilometres**.
2. **Impact of Short-Turns and Flex Fleet:** Adding short-turning and flex insertion specifically eliminates the extreme tail of crowding, slashing left-behind passenger events from 1,679 down to 1,197 (−28.7% further reduction) for just 1.4% extra mileage.
3. **Journey Time Net Benefit:** Even though holding intentionally delays certain buses by 20–120 seconds at timing stops, the overall passenger journey time (wait + ride) decreases by 0.96 minutes, confirming that wait reductions vastly outweigh holding delays.

---

### 9.2 Stress-Test Scenarios

#### Scenario 2: Heavy Rain Evening
*Heavy monsoon downpour from 16:30 to 21:00 IST: +35% traffic travel times, +25% boarding dwell times, +15% passenger demand, +10% EV battery draw.*
- **Average Wait Time:** Cut from $4.74\text{ min}$ to **$3.43\text{ min}$ (−27.7%)**.
- **Left-Behind Passengers:** Reduced from $8,421$ to **$2,797$ (−66.8%)**.
- **Bunching Events:** Dropped from $2,773$ to **$859$ (−69.0%)**.
- **Bus-Km Added:** $+1.7\%$.

#### Scenario 3: Event Surge
*A localized crowd surge of 2,500 passengers exiting an event at a single corridor stop over 45 minutes (18:00 to 18:45 IST).*
- **Average Wait Time:** Cut from $4.19\text{ min}$ to **$3.22\text{ min}$ (−23.1%)**.
- **Left-Behind Passengers:** Reduced from $6,961$ to **$2,496$ (−64.1%)**.
- **Peak Load (P99):** Dropped from $97.3\%$ to **$84.2\%$ (−13.5%)**.

#### Scenario 4: 20% Telemetry Sensor Failure
*One in every five buses suffers complete automated passenger counter (APC) failure or drift during the day.*
- **Average Wait Time:** Maintained at **$3.24\text{ min}$ (−22.9% vs baseline)**.
- **Sensor Robustness:** Watchdog successfully caught 963 of 979 faults (98.4%), allowing the controller to maintain full performance via ETM ticket fallback curves.

#### Scenario 5: Peak-Hour Mechanical Bus Breakdowns
*In-service vehicle breakdowns occurring during peak morning (08:45 IST) and evening (17:45 IST) rush hours.*
- In the fixed schedule, replacing a disabled bus requires an estimated 45 minutes of manual depot coordination.
- NextRoute detects the breakdown instantly, transfers stranded riders, and dispatches a standby flex bus within 3 minutes.
- **Average Wait Time:** Cut from $4.21\text{ min}$ to **$3.24\text{ min}$ (−23.0%)**.
- **Left-Behind Passengers:** Slashed from $4,055$ to **$1,222$ (−69.9%)**.

---

## 10. Operational Feasibility, Limitations & Roadmap

### 10.1 Key Assumptions & Scientific Limitations
1. **Passenger Demand Synthesis:** While transit geometry, stops, and timetables are 100% genuine MTC data, individual passenger agent origins and destinations are generated via spatial gravity modeling in the absence of open MTC smart-card transaction matrices.
2. **Driver Adherence:** The simulation assumes professional driver compliance with in-cab holding countdown instructions. In real operations, driver training, incentive structures, and enforcement mechanisms will be critical.
3. **Corridor Boundary:** The current prototype models the GST Road corridor as a closed system. Inter-corridor transfers and depot deadheading outside the corridor boundaries are not modeled.

### 10.2 Production Implementation Roadmap

```
Phase 1: Hardware & IoT Audit (Months 1–2)
├── Validate MTC AIS-140 GPS feed latency (< 10 seconds).
└── Calibrate ETM ticketing upload streams and CCTV camera angles.

Phase 2: Shadow Dispatch Pilot (Months 3–4)
├── Deploy NextRoute in "Advisory Mode" at Central MTC Control Room.
└── Compare controller recommendations against manual dispatcher logs.

Phase 3: Corridor Field Demonstration (Months 5–6)
├── Equip Line 91 (Tambaram ↔ Thiruvanmiyur) with driver display units.
├── Enforce 20–120s holding at 4 designated stops (Tambaram, Chromepet, Guindy, Velachery).
└── Measure field headway variance and passenger boarding throughput.
```

---

## 11. Conclusion

NextRoute demonstrates that chronic bus bunching and severe passenger wait times across Chennai's trunk transit corridors are not inevitable consequences of urban congestion. By replacing static timetable adherence with **closed-loop adaptive control**, transit operators can achieve massive service improvements—**cutting passenger waits by 23%, slashing left-behind riders by 70%, and eliminating 65% of bus bunching**—without capital-intensive fleet expansions or disruptive route redesigns. NextRoute provides a defensible, mathematically validated blueprint for the next generation of intelligent public transportation in India.
