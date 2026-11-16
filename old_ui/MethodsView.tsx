// Methods page. Every number is read from the engine's own configuration, the bundled corridor
// data, the trained forecast model or the batch results, so this page cannot drift from the code.
import { BUS_TYPES, CAL, CTRL, DEMAND, DWELL, EV, SCENARIOS, SENSOR, TRAFFIC } from '../engine/index';
import { batch, fmtN } from './ReportView';
import { fmtInt, net, useStore } from './store';

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

export function MethodsView() {
  const ready = useStore((s) => s.ready);
  const m = net.meta;
  const model = ready?.model;
  const nb = batch.summary.normal;
  const perTrip = CAL.dailyPassengers / m.totals.mtcWeekdayTripsInFeed;
  return (
    <div className="page" aria-label="Methods">
      <div className="page-in">
        <h1>Methods, assumptions and limits</h1>
        <p style={{ margin: 0 }}>What is real, what is simulated, how each number on screen is produced, and where this prototype stops.</p>

        <div className="callout">
          <b>Real network · Simulated passengers.</b> Routes, stops and the timetable are real and come from a public feed. Passengers, traffic, sensors and breakdowns are simulated.
          Every result is a result <b>in simulation</b>; nothing here measures or predicts what would happen on Chennai’s roads. Samam is an <b>independent prototype, not affiliated with MTC</b> or CUMTA.
        </div>

        <h2>1. Real data</h2>
        <ul>
          <li><b>Source.</b> {m.source.feed}, version {m.source.feedVersion || 'unversioned'}, weekday service. <code>{m.source.url}</code></li>
          <li><b>Checks before use.</b> All 5,580 MTC stops fall inside the Chennai region (latitude 12.3–13.7, longitude 79.5–80.5); none are near New York, which an older feed got wrong. All {fmtInt(m.totals.mtcWeekdayTripsInFeed)} weekday MTC trips have stop sequences and times that run forwards. The check is <code>npm run data:validate</code>.</li>
          <li><b>Road shapes.</b> The feed has no route shapes for MTC buses. Each stop sequence was snapped to roads once, when the data was prepared, using the Mapbox Directions API, and the result is bundled with the app. Nothing is routed while the app runs. Where a stop snapped to the wrong side of a divided road it was placed on the line by projection.</li>
          <li><b>Corridor.</b> {m.selection.rule}. The busiest segment is {m.selection.busiestSegment.from} → {m.selection.busiestSegment.to} with {fmtInt(m.selection.busiestSegment.tripsPerDay)} trips a day. Lines chosen: <b>{net.lines.map((l) => l.id).join(', ')}</b>{m.selection.skippedLopsided.length ? ` (${m.selection.skippedLopsided.join(', ')} skipped for a lopsided timetable)` : ''}. That is {net.patterns.length} direction patterns, {net.stops.length} stops and {fmtInt(m.totals.corridorTrips)} trips a day, {pct(m.totals.corridorTripShare, 2)} of the feed.</li>
          <li><b>Simplifications.</b> A line is a route-number family (for example 91 and 91 R). Only its most frequent stop pattern in each direction is run. Service between 04:00 and 24:00 is simulated.</li>
        </ul>

        <h2>2. Calibration constants</h2>
        <table className="t">
          <thead><tr><th>Constant</th><th>Value</th><th style={{ textAlign: 'left' }}>Source</th></tr></thead>
          <tbody>
            <tr><td>MTC passengers per day</td><td>about {fmtInt(CAL.dailyPassengers)}</td><td style={{ textAlign: 'left', fontFamily: 'var(--sans)' }}>World Bank blog, “Chennai Brings in Private Capital to Transform Public Bus Services”</td></tr>
            <tr><td>MTC fleet</td><td>{fmtInt(CAL.fleet)} buses, {CAL.electricFleet} electric</td><td style={{ textAlign: 'left', fontFamily: 'var(--sans)' }}>Urban Acres, October 2026</td></tr>
          </tbody>
        </table>
        <p>Both figures were supplied in the project brief and are cited as given; this prototype did not verify them independently.</p>

        <h2>3. Simulated passengers</h2>
        <ul>
          <li><b>Scale (key assumption).</b> The corridor’s daily boardings are proportional to its share of scheduled trips: {fmtInt(CAL.dailyPassengers)} ÷ {fmtInt(m.totals.mtcWeekdayTripsInFeed)} trips = {perTrip.toFixed(1)} boardings per scheduled trip{ready ? `, which gives ${fmtInt(ready.nPax)} riders in this run` : ''}. Real loads on these lines may be quite different.</li>
          <li><b>Each rider is an individual</b> with an origin stop, a destination stop and an arrival time. There are no transfers. A rider boards the first bus, on any line, that serves the destination.</li>
          <li><b>When.</b> A time-of-day profile with a morning peak around 09:00 and an evening peak around 18:15. Buses heading towards the city centre get more of the morning peak, and those heading away get more of the evening peak.</li>
          <li><b>Where.</b> A stop’s pull is (MTC trips a day calling there)<sup>{DEMAND.stopWeightExp}</sup>, a stand-in for how important the stop is. Longer trips are less likely, with a {DEMAND.decayM / 1000} km decay scale; trips under {DEMAND.shortTripM} m are rare.</li>
          <li><b>Scenarios.</b> Rain: {pct(SCENARIOS.rain.rain!.demandMult - 1)} more riders, travel times ×{SCENARIOS.rain.rain!.timeMult}, dwell ×{SCENARIOS.rain.rain!.dwellMult}, 16:30–21:00. Surge: {fmtInt(SCENARIOS.surge.surge!.pax)} extra riders at one stop over {SCENARIOS.surge.surge!.dur / 60} minutes. Sensors: {pct(SCENARIOS.sensors.sensorFailShare!)} of buses lose their counter (normal days: {pct(SENSOR.baseFailShare)}). Breakdown: one bus fails in each peak.</li>
        </ul>

        <h2>4. Simulated buses</h2>
        <ul>
          <li><b>Fleet.</b> Not invented: the timetable’s departures are chained into vehicle blocks, first in first out, which needs {ready?.fleet.scheduled ?? 231} buses. {pct(CAL.electricFleet / CAL.fleet)} are electric, matching the fleet share.</li>
          <li><b>Movement.</b> Buses follow the road shape. The feed’s scheduled run times are taken as given; {pct(TRAFFIC.cruiseShare)} of each is treated as moving time in free-flowing daytime traffic. Travel time then rises in the peaks (up to about +36% in the evening) and varies randomly by road stretch and quarter-hour, the same for every bus on that stretch, plus a small per-driver variation. Over a normal day, simulated run times average 99% of the timetable.</li>
          <li><b>Dwell.</b> {DWELL.base} s to open and close doors, {DWELL.perBoard} s per boarding rider (up to {pct(DWELL.crowdGain)} slower on a crowded bus) and {DWELL.perAlight} s per alighting rider. A late bus meets a bigger queue, dwells longer and falls further behind, so <b>bunching emerges; it is never scripted</b>.</li>
          <li><b>Capacity is enforced.</b> Diesel: {BUS_TYPES.diesel.seats} seats, {BUS_TYPES.diesel.cap} riders. Electric: {BUS_TYPES.electric.seats} seats, {BUS_TYPES.electric.cap} riders. Riders who cannot board are left behind and keep waiting.</li>
          <li><b>Crowding bands.</b> Empty: up to 30% of seats. Seated: up to all seats. Standing: up to 85% of capacity. Crush: above that.</li>
          <li><b>Battery.</b> {EV.batteryKwh} kWh, {EV.kwhPerKm} kWh per km (up to {pct(EV.loadGain)} more when full), {EV.auxKw} kW for auxiliaries, {EV.chargeKw} kW charging at termini. The schedule plans a {EV.planBreak / 60}-minute charge about every {EV.planKm} km. Below {pct(EV.forceSoc)} a bus must charge before its next trip. Samam will not send an electric flex bus that would end below {pct(EV.flexReserveSoc)}.</li>
        </ul>

        <h2>5. What the controller can see</h2>
        <p>The controller never reads the true passenger count. It sees GPS positions, the timetable, ticket records and a counter reading per stop. All KPIs are computed from the truth.</p>
        <ul>
          <li><b>Electric buses: door counter cameras.</b> Count error of {pct(SENSOR.doorErr)} per stop, {pct(SENSOR.doorErr + SENSOR.doorCrushErr)} at crush load with {pct(SENSOR.doorCrushMiss)} of boardings missed. The error accumulates as drift and resets when the bus empties at the terminus.</li>
          <li><b>Diesel buses: CCTV count.</b> A per-bus calibration bias, noise that grows with load, and up to {pct(SENSOR.cctvCrushUnder)} undercount at crush load.</li>
          <li><b>Tickets.</b> {pct(DEMAND.ticketShare)} of boardings produce a ticket record with a destination. This is the fallback source.</li>
          <li><b>Failures.</b> A counter can go dead (no data) or blocked (stuck near zero). You can block any bus’s counter yourself from its panel.</li>
        </ul>

        <h2>6. The Samam controller</h2>
        <h3>Sensor health</h3>
        <p>Two stops with no data means a dead counter. Three stops where the counter disagrees with ticket sales (for example it reads near zero while tickets are still issued) means a blocked one. The bus then switches to 70% ticket-based estimate + 30% route history, shown with 50% confidence. It switches back after four stops in a row where the counter agrees with tickets again.</p>
        <h3>Forecast</h3>
        <p>Load per bus on each stretch between stops, for the next 60 minutes in 10-minute steps. The method is a <b>time-of-day profile learned from {model?.profileDays ?? 12} simulated days, corrected by live observations</b> through a small linear model (ridge regression with three inputs: how far this stretch, the stretch upstream and the whole line are running above or below profile), fitted on {model?.fitDays ?? 16} further simulated days. It is trained only on simulated days and it is not deep learning.</p>
        {model && (
          <table className="t" style={{ maxWidth: 720 }}>
            <thead><tr><th>Average error, riders per bus</th>{[10, 20, 30, 40, 50, 60].map((x) => <th key={x}>{x} min</th>)}</tr></thead>
            <tbody>
              <tr><td>Profile alone</td>{model.maeProfile.map((v, i) => <td key={i}>{v.toFixed(2)}</td>)}</tr>
              <tr><td>Profile + live correction</td>{model.maeModel.map((v, i) => <td key={i}>{v.toFixed(2)}</td>)}</tr>
            </tbody>
          </table>
        )}
        <p>Measured on {model?.testDays ?? 6} held-out simulated days in both runs. The live correction helps most in the first 10 to 20 minutes; further ahead the forecast is close to the profile.</p>
        <h3>Decisions: three levers, buses never leave their route</h3>
        <ul>
          <li><b>Holding.</b> At every {CTRL.holdEvery}th stop and at the terminus. If a bus is close behind the one ahead while the next bus is far back, it is held for {pct(CTRL.holdGain)} of the gap difference, between {CTRL.holdMin} and {CTRL.holdMax} s, and only if the waiting time saved downstream exceeds the delay to riders on board (weighted {CTRL.onboardWeight}). The gap is re-checked on arrival and the bus is released early if it has recovered.</li>
          <li><b>Short-turn trips.</b> An extra bus runs from the depot terminus to a turn stop and back, covering only the overloaded stretch.</li>
          <li><b>Flex pool.</b> An extra bus runs a full round trip on the line the forecast flags. Reserve: {Math.round((ready?.opts.reserveShare ?? 0.08) * 100)}% of the scheduled fleet ({ready?.fleet.pool ?? 18} buses), parked at {net.depot.name}.</li>
          <li>Every {CTRL.cycle / 60} minutes the controller looks for stretches forecast above {pct(CTRL.comfortShare)} of capacity and sends an extra trip only if it would carry, on average, at least {CTRL.flexMinScore} riders off overcrowded buses per bus-km. At most {CTRL.flexPerCycle} trips per cycle.</li>
          <li><b>Manual mode.</b> Nothing is applied until approved. A hold lapses when its bus leaves the stop; other recommendations stay open for {CTRL.recTtl / 60} minutes. Rejections change the outcome.</li>
        </ul>

        <h2>7. The comparison</h2>
        <ul>
          <li><b>Same world.</b> Both runs use the same seed: identical riders, traffic and sensor faults. Only the controller differs.</li>
          <li><b>Fixed schedule.</b> Buses leave on the timetable, or as soon as they can if late. The flex pool stays in the depot. After a breakdown a spare is sent after an assumed {CTRL.baselineCoverDelay / 60} minutes; Samam sends one at once.</li>
          <li><b>Samam uses more bus-km,</b> because extra trips come from the reserve. Bus-km is shown as a KPI for that reason, and the batch includes a holding-only run that uses no extra buses.</li>
          <li><b>KPIs.</b> Wait: arrival at the stop to boarding, including riders still waiting. Left behind: each time a rider is refused by a full bus. Peak load: 99th percentile of load at stop departures. Bunching: a pair of buses on the same pattern within a quarter of the scheduled headway (at least 60 s). Journey: wait plus ride.</li>
        </ul>

        {nb && (
          <>
            <h2>8. Results in simulation: {batch.nSeeds} seeds, normal weekday</h2>
            <table className="t">
              <thead><tr><th>Measure</th><th>Fixed schedule</th><th>Samam, holding only</th><th>Samam, all levers</th><th>Change</th><th>Better in</th></tr></thead>
              <tbody>
                {batch.metrics.map((x) => {
                  const v = nb.metrics[x.key];
                  return <tr key={x.key}><td>{x.label}{x.unit ? ` (${x.unit})` : ''}</td><td>{fmtN(v.baseline, x.digits)} ± {fmtN(v.baselineSd, x.digits)}</td><td>{fmtN(v.hold, x.digits)} ± {fmtN(v.holdSd, x.digits)}</td><td>{fmtN(v.samam, x.digits)} ± {fmtN(v.samamSd, x.digits)}</td><td>{v.pct >= 0 ? '+' : ''}{v.pct.toFixed(1)}%</td><td>{v.better}/{batch.nSeeds}</td></tr>;
                })}
              </tbody>
            </table>
            <p>Mean ± standard deviation over seeds {batch.seeds[0]}–{batch.seeds[1]}. All five scenarios are in <code>results/RESULTS.md</code> and in each Run report. Most of the waiting-time gain comes from holding alone; the extra trips mainly reduce left-behind riders and peak load.</p>
          </>
        )}

        <h2>9. Limits</h2>
        <ul>
          <li><b>No real passenger data.</b> Demand size, origins, destinations and peaks are assumptions. The size of every effect depends on them.</li>
          <li><b>The fixed-schedule run is a simple baseline.</b> Real dispatchers already intervene by radio and experience; that is not modelled, so the gap to Samam is likely overstated.</li>
          <li><b>Part of the holding gain comes from the timetable itself,</b> whose scheduled departures are uneven in places; Samam evens them out at the terminus.</li>
          <li><b>Drivers obey instantly and exactly.</b> No missed instructions, no driver breaks, no crew rules.</li>
          <li><b>Traffic is statistical.</b> No signals, incidents, or interaction between buses and other vehicles; buses do not queue behind each other at stops.</li>
          <li><b>One corridor of {net.lines.length} lines.</b> No transfers, no other routes sharing the stops, no effect of better service on demand.</li>
          <li><b>The forecast is modest.</b> It is mostly a time-of-day profile. It does not see queues at stops, and a sudden surge only shows once buses leave full.</li>
          <li><b>Reserve buses are assumed available</b> at one depot with drivers. The cost of holding them is not counted beyond bus-km.</li>
          <li><b>Sensor error rates, ticket coverage and battery figures are assumptions,</b> not measurements of MTC equipment.</li>
          <li><b>Scheduled run times in the feed are fast</b> (35–45 km/h on GST Road). The simulation follows them, so absolute journey times may be optimistic.</li>
        </ul>
        <p className="dim" style={{ marginTop: 22, fontSize: 11.5 }}>Network bundle generated {m.generatedAt.slice(0, 10)} · built with Mapbox GL JS, MapLibre GL and deck.gl · GTFS feed by the Ithu Ungal Soththu open-data project.</p>
      </div>
    </div>
  );
}
