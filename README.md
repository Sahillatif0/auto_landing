# Autonomous Landing Logic Simulator

Fly a civil jet through Metro Airspace and hand it over to autoland. The simulator starts stationary on RWY-09L with landing gear down.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite in a browser with WebGL 2. `npm test` runs the flight and clearance scenarios. `npm run build` produces the static site in `dist/`.

## Judge demo

1. Hold **W** to accelerate on RWY-09L. Tap **Space** near 132 kt to rotate early, or keep holding **W** for automatic rotation. Use **A/D** to steer and **S** to brake while on the runway.
2. For a repeatable landing, press **F** to start airborne near RWY-09L and **L** to engage autoland. Watch the telemetry and approach gates through intercept, the 3° glideslope, flare, and rollout. The completion card shows touchdown sink rate, centerline offset, and stopping distance.
3. Repeat **F → L**, then press **T** during final to inject civil traffic or **G** to withdraw ATC clearance. The aircraft climbs on a go-around and selects another clear runway if one is available. Press **T** again to remove the injected aircraft. A manual ATC release gives a green light only after the safety zone is clear.
4. Press **R** to return to the runway. **H** hides the HUD, **C** cycles camera views, and **?** opens the shortcut sheet.

Use **Simulation speed** to select **1×**, **2×**, **4×**, or **8×**. **M** cycles the presets. The rate applies to the whole simulation — aircraft, traffic, and runway clearance — in manual flight and autoland alike.

**Airspace radar** shows the assigned approach, runway clearance, and traffic conflicts. **Auto** fits the runways and your aircraft, while **5 km** and **2 km** center the map on your aircraft at a fixed scale.

Press **U** or click **Auto takeoff** while lined up near the start of a runway. It waits for green ATC clearance, accelerates, rotates, raises the gear after liftoff, and hands control back at **120 m AGL**. Press **U** again to disengage.

A touchdown that is too hard, banked, or made with the gear up ends in a crash: the aircraft stops, an explosion, debris, and a smoke plume mark the impact, and **R** resets the airspace.

For manual altitude changes, hold **Space** to climb or **X** to descend. On a manual landing, reduce throttle with **S** in the air, extend gear with **V** if it is up, and use a light **Space** input to flare near the runway. Hold **S** to brake after touchdown.

| Action | Keys |
| --- | --- |
| Throttle up or down, ground braking | W/S or ↑/↓ |
| Ground steering or airborne roll | A/D or ←/→ |
| Rudder or alternate ground steering | Q/E |
| Pitch up or down | Space/X |
| Boost or toggle gear | Shift/V |

The traffic and ATC buttons target the assigned runway during autoland and the nearest threshold in manual flight. Runway reset and airborne start restore the default demo airspace.

## Implementation

- `src/physics` integrates ground roll, takeoff, airborne motion, contact, and braking at 60 steps per second.
- `src/world` creates the seeded Three.js city and the three airports. The runway geometry, contact checks, approach corridors, and PAPI all use the same meter-based coordinates. ATC updates each simulation step from the locations of the civil aircraft.
- `src/autopilot` ranks clear runways and uses turn-radius-constrained intercept paths, lookahead lateral tracking, and vertical speed feedback. A higher or off-axis arrival approaches at about 250 m before descending to capture the 3° path.
- `src/ui` draws live telemetry and radar and exposes the same demo actions as the keyboard controls.

## Sources

- The upstream [Web Flight Simulator](https://github.com/dimartarmizi/web-flight-simulator) was accessed through its GitHub source archive. The engine exhaust shader is retained and the NPC system was adapted to the local coordinate model. The upstream non-commercial terms are in [LICENSE](LICENSE).
- Three GLB buildings and their shared color map are from [Kenney City Kit (Commercial)](https://kenney.nl/assets/city-kit-commercial) under [CC0](public/models/kenney/LICENSE.txt). Runway surfaces, airfield buildings, the rest of the city, and the jet geometry are procedural.
- The [Sanjays2402 flight simulator](https://github.com/Sanjays2402/flight-sim) and [skyrunner](https://github.com/cemremete/skyrunner) were reviewed as arcade flight references.
