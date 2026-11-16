# Samam batch results (simulation)

Generated 2026-11-16 by `npm run batch`. 20 seeds (101–120) per scenario, the same passengers and traffic in every arm of a seed. All figures are **in simulation**: real MTC network and timetable, simulated passengers. They are not predictions of real-world results.

Corridor: 91, 500, 70V, 104C, 66P, 21G, 18A · 339 stops · 2171 scheduled trips/day.

Values are mean ± standard deviation across seeds. "Δ vs fixed" is the mean paired difference with a 95% confidence interval; "better in" counts seeds where the arm beat the fixed schedule.

## Normal weekday

Typical weekday demand and traffic.

| Metric | Fixed schedule | Samam, holding only | Samam, all levers | Δ vs fixed (all levers) | Better in |
|---|---:|---:|---:|---:|---:|
| Average wait (min) | 4.20 ± 0.03 | 3.30 ± 0.02 | 3.24 ± 0.02 | -0.96 ± 0.01 (-22.9%) | 20/20 |
| 90th pct wait (min) | 10.09 ± 0.10 | 7.64 ± 0.08 | 7.55 ± 0.09 | -2.54 ± 0.06 (-25.2%) | 20/20 |
| Left behind (events) | 3,960 ± 344 | 1,679 ± 204 | 1,197 ± 139 | -2,763 ± 142 (-69.8%) | 20/20 |
| Peak load (p99) (% cap) | 96.0 ± 1.2 | 85.8 ± 1.5 | 82.0 ± 1.6 | -14.0 ± 0.7 (-14.6%) | 20/20 |
| Crush departures (%) | 1.65 ± 0.09 | 1.00 ± 0.07 | 0.82 ± 0.06 | -0.82 ± 0.03 (-50.0%) | 20/20 |
| Bunching events | 1,359 ± 68 | 407 ± 23 | 476 ± 24 | -884 ± 29 (-65.0%) | 20/20 |
| Bus-km (km) | 72,145 ± 3 | 72,141 ± 3 | 73,158 ± 74 | +1,013 ± 34 (+1.4%) | 0/20 |
| Average journey (min) | 18.74 ± 0.07 | 17.90 ± 0.05 | 17.79 ± 0.05 | -0.96 ± 0.02 (-5.1%) | 20/20 |

Samam actions per day (mean): 2,621 holds, 31.9 short-turn trips, 6.2 flex trips, 0.0 breakdown covers. Sensor faults that occurred in service: 101 over 20 days, 98 detected (97%), median detection delay 2.7 min, 19 buses flagged with no fault.

## Heavy rain evening

Rain from 16:30 to 21:00: slower traffic, longer dwells, more riders.

| Metric | Fixed schedule | Samam, holding only | Samam, all levers | Δ vs fixed (all levers) | Better in |
|---|---:|---:|---:|---:|---:|
| Average wait (min) | 4.74 ± 0.09 | 3.52 ± 0.04 | 3.43 ± 0.05 | -1.31 ± 0.03 (-27.7%) | 20/20 |
| 90th pct wait (min) | 11.85 ± 0.27 | 8.42 ± 0.13 | 8.26 ± 0.11 | -3.59 ± 0.12 (-30.3%) | 20/20 |
| Left behind (events) | 8,421 ± 1,153 | 3,917 ± 585 | 2,797 ± 471 | -5,624 ± 453 (-66.8%) | 20/20 |
| Peak load (p99) (% cap) | 100.0 ± 0.0 | 95.5 ± 1.4 | 92.8 ± 1.4 | -7.2 ± 0.7 (-7.2%) | 20/20 |
| Crush departures (%) | 2.56 ± 0.13 | 1.71 ± 0.11 | 1.46 ± 0.10 | -1.10 ± 0.06 (-43.1%) | 20/20 |
| Bunching events | 2,773 ± 183 | 778 ± 58 | 859 ± 52 | -1,913 ± 86 (-69.0%) | 20/20 |
| Bus-km (km) | 72,124 ± 3 | 72,120 ± 4 | 73,319 ± 79 | +1,195 ± 37 (+1.7%) | 0/20 |
| Average journey (min) | 21.86 ± 0.14 | 20.68 ± 0.09 | 20.51 ± 0.09 | -1.35 ± 0.04 (-6.2%) | 20/20 |

Samam actions per day (mean): 2,631 holds, 41.7 short-turn trips, 6.4 flex trips, 0.0 breakdown covers. Sensor faults that occurred in service: 105 over 20 days, 101 detected (96%), median detection delay 3.2 min, 30 buses flagged with no fault.

## Event surge

A crowd of 2,500 leaves an event at one stop over 45 minutes.

| Metric | Fixed schedule | Samam, holding only | Samam, all levers | Δ vs fixed (all levers) | Better in |
|---|---:|---:|---:|---:|---:|
| Average wait (min) | 4.19 ± 0.04 | 3.30 ± 0.02 | 3.22 ± 0.02 | -0.97 ± 0.02 (-23.1%) | 20/20 |
| 90th pct wait (min) | 10.10 ± 0.13 | 7.65 ± 0.08 | 7.53 ± 0.10 | -2.57 ± 0.07 (-25.4%) | 20/20 |
| Left behind (events) | 6,961 ± 1,199 | 4,129 ± 666 | 2,496 ± 466 | -4,465 ± 617 (-64.1%) | 20/20 |
| Peak load (p99) (% cap) | 97.3 ± 1.2 | 87.8 ± 1.5 | 84.2 ± 1.2 | -13.2 ± 0.6 (-13.5%) | 20/20 |
| Crush departures (%) | 1.76 ± 0.08 | 1.11 ± 0.07 | 0.93 ± 0.06 | -0.83 ± 0.03 (-47.0%) | 20/20 |
| Bunching events | 1,365 ± 66 | 410 ± 25 | 493 ± 29 | -872 ± 29 (-63.9%) | 20/20 |
| Bus-km (km) | 72,145 ± 3 | 72,141 ± 3 | 73,201 ± 80 | +1,056 ± 37 (+1.5%) | 0/20 |
| Average journey (min) | 18.72 ± 0.07 | 17.89 ± 0.05 | 17.75 ± 0.05 | -0.97 ± 0.02 (-5.2%) | 20/20 |

Samam actions per day (mean): 2,617 holds, 34.6 short-turn trips, 6.2 flex trips, 0.0 breakdown covers. Sensor faults that occurred in service: 101 over 20 days, 98 detected (97%), median detection delay 2.6 min, 35 buses flagged with no fault.

## 20% sensors failing

One in five buses has a dead or blocked passenger counter during the day.

| Metric | Fixed schedule | Samam, holding only | Samam, all levers | Δ vs fixed (all levers) | Better in |
|---|---:|---:|---:|---:|---:|
| Average wait (min) | 4.20 ± 0.03 | 3.30 ± 0.02 | 3.24 ± 0.02 | -0.96 ± 0.01 (-22.9%) | 20/20 |
| 90th pct wait (min) | 10.09 ± 0.10 | 7.65 ± 0.08 | 7.54 ± 0.07 | -2.55 ± 0.06 (-25.3%) | 20/20 |
| Left behind (events) | 3,960 ± 344 | 1,707 ± 193 | 1,193 ± 172 | -2,767 ± 154 (-69.9%) | 20/20 |
| Peak load (p99) (% cap) | 96.0 ± 1.2 | 85.9 ± 1.4 | 82.0 ± 1.7 | -14.1 ± 0.8 (-14.6%) | 20/20 |
| Crush departures (%) | 1.65 ± 0.09 | 1.01 ± 0.07 | 0.82 ± 0.06 | -0.82 ± 0.04 (-50.0%) | 20/20 |
| Bunching events | 1,359 ± 68 | 404 ± 21 | 478 ± 29 | -882 ± 32 (-64.9%) | 20/20 |
| Bus-km (km) | 72,145 ± 3 | 72,141 ± 3 | 73,169 ± 69 | +1,024 ± 32 (+1.4%) | 0/20 |
| Average journey (min) | 18.74 ± 0.07 | 17.90 ± 0.05 | 17.79 ± 0.05 | -0.96 ± 0.01 (-5.1%) | 20/20 |

Samam actions per day (mean): 2,606 holds, 32.5 short-turn trips, 6.2 flex trips, 0.0 breakdown covers. Sensor faults that occurred in service: 979 over 20 days, 963 detected (98%), median detection delay 3.7 min, 17 buses flagged with no fault.

## Bus breakdown

A bus breaks down in each peak (08:45 and 17:45).

| Metric | Fixed schedule | Samam, holding only | Samam, all levers | Δ vs fixed (all levers) | Better in |
|---|---:|---:|---:|---:|---:|
| Average wait (min) | 4.21 ± 0.03 | 3.31 ± 0.02 | 3.24 ± 0.02 | -0.97 ± 0.01 (-23.0%) | 20/20 |
| 90th pct wait (min) | 10.13 ± 0.11 | 7.65 ± 0.08 | 7.56 ± 0.10 | -2.57 ± 0.07 (-25.3%) | 20/20 |
| Left behind (events) | 4,055 ± 393 | 1,731 ± 227 | 1,222 ± 135 | -2,833 ± 168 (-69.9%) | 20/20 |
| Peak load (p99) (% cap) | 96.1 ± 1.3 | 86.4 ± 1.6 | 82.4 ± 1.5 | -13.7 ± 0.7 (-14.3%) | 20/20 |
| Crush departures (%) | 1.67 ± 0.09 | 1.03 ± 0.08 | 0.85 ± 0.07 | -0.83 ± 0.03 (-49.5%) | 20/20 |
| Bunching events | 1,358 ± 62 | 407 ± 26 | 474 ± 25 | -884 ± 26 (-65.1%) | 20/20 |
| Bus-km (km) | 72,053 ± 27 | 72,076 ± 23 | 73,109 ± 69 | +1,057 ± 35 (+1.5%) | 0/20 |
| Average journey (min) | 18.77 ± 0.07 | 17.91 ± 0.05 | 17.80 ± 0.05 | -0.97 ± 0.02 (-5.2%) | 20/20 |

Samam actions per day (mean): 2,622 holds, 32.9 short-turn trips, 6.3 flex trips, 1.9 breakdown covers. Sensor faults that occurred in service: 102 over 20 days, 99 detected (97%), median detection delay 2.7 min, 24 buses flagged with no fault.

## Forecast accuracy (held-out simulated days)

Mean absolute error in riders per bus, by look-ahead:

| Look-ahead | 10 min | 20 min | 30 min | 40 min | 50 min | 60 min |
|---|---:|---:|---:|---:|---:|---:|
| Time-of-day profile only | 5.38 | 5.38 | 5.39 | 5.41 | 5.43 | 5.46 |
| Profile + live correction | 4.65 | 5.12 | 5.24 | 5.31 | 5.36 | 5.41 |

Training: 12 profile days, 16 fit days, 6 test days x 2 arms (profile 9001-9012, fit 9101-9108 (fixed schedule) and 9151-9158 (Samam), test 9201-9206 (both arms)).
