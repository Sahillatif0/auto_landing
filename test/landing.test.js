import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { createRunways } from '../src/world/runways.js';
import { AirspaceATC, inRunwaySafetyZone } from '../src/world/AirspaceATC.js';
import { GroundTakeoffPhysics } from '../src/physics/GroundTakeoffPhysics.js';
import { AutonomousLandingController, LandingState } from '../src/autopilot/AutonomousLandingController.js';
import { NPCSystem } from '../src/systems/npcSystem.js';
import { GEAR_HEIGHT, KNOTS, runwayPoint } from '../src/physics/flightMath.js';

const dt = 1 / 60;
const manual = { throttle: 1, pitch: 1, roll: 0, yaw: 0, gearDown: true };

function simulation() {
  const runways = createRunways();
  const aircraft = new GroundTakeoffPhysics(runways);
  const traffic = new NPCSystem(new Scene(), runways);
  const atc = new AirspaceATC(runways);
  const autopilot = new AutonomousLandingController(runways);
  let time = 0;
  return { runways, aircraft, traffic, atc, autopilot, step(command = manual) {
    traffic.update(time);
    atc.update(traffic.aircraft);
    aircraft.update(dt, autopilot.command(aircraft, dt) ?? command);
    autopilot.observe(aircraft);
    time += dt;
  } };
}

function until(sim, condition, maxSeconds) {
  for (let frame = 0; frame < maxSeconds / dt; frame++) {
    if (condition()) return;
    sim.step();
  }
  assert.fail(`Condition timed out in ${sim.autopilot.state}: ${sim.autopilot.message}`);
}

function finishLanding(sim, target = null) {
  until(sim, () => sim.autopilot.state === LandingState.COMPLETE, 174);
  const summary = sim.autopilot.summary;
  if (target) assert.equal(summary.runway, target.id);
  assert.equal(sim.aircraft.speed, 0);
  assert.equal(sim.aircraft.state, 'GROUNDED');
  assert.ok(summary.sinkRate > 0 && summary.sinkRate < 2.5);
  assert.ok(summary.offset < 2);
  assert.ok(summary.stoppingDistance > 0 && summary.stoppingDistance < 550);
  assert.ok(summary.touchdownAlong + summary.stoppingDistance < sim.autopilot.runway.length);
  return summary;
}

test('ground steering has no bank, brake stops the taxi, and rotation lifts off at runway speed', () => {
  const sim = simulation();
  const { aircraft, runways } = sim;
  assert.equal(aircraft.speed, 0);
  assert.equal(aircraft.state, 'GROUNDED');
  assert.equal(aircraft.position.y, GEAR_HEIGHT);
  for (let n = 0; n < 90; n++) sim.step({ ...manual, throttle: 0.28, yaw: 0.5, roll: 1 });
  assert.notEqual(aircraft.heading, runways[0].heading);
  assert.equal(aircraft.roll, 0);
  for (let n = 0; n < 140; n++) sim.step({ ...manual, throttle: 0, brake: 1, yaw: 0 });
  assert.equal(aircraft.speed, 0);
  aircraft.spawn(runways[0]);
  until(sim, () => aircraft.state === 'AIRBORNE', 17);
  assert.ok(aircraft.speed * KNOTS > 130);
  assert.ok(aircraft.pitch >= 8 * Math.PI / 180);
  until(sim, () => aircraft.position.y >= 120, 22);
  sim.autopilot.toggle(aircraft);
  finishLanding(sim);
});

test('hands-off demo passes intercept, glideslope, flare, rollout and stops on the closest runway', () => {
  const sim = simulation();
  const { runways, aircraft, autopilot } = sim;
  aircraft.positionForApproach(runways[0]);
  autopilot.toggle(aircraft);
  for (const expected of [LandingState.INTERCEPT, LandingState.FINAL, LandingState.FLARE, LandingState.ROLLOUT]) {
    until(sim, () => autopilot.state === expected, 28);
    assert.equal(autopilot.runway, runways[0]);
  }
  finishLanding(sim, runways[0]);
});

for (const conflict of ['traffic', 'ATC hold']) {
  test(`final approach waves off immediately on ${conflict} and lands on another runway`, () => {
    const sim = simulation();
    const { runways, aircraft, autopilot, traffic, atc } = sim;
    aircraft.positionForApproach(runways[0]);
    autopilot.toggle(aircraft);
    until(sim, () => autopilot.state === LandingState.FINAL, 15);
    const previousAltitude = aircraft.position.y;
    if (conflict === 'traffic') traffic.toggleConflict(runways[0]);
    else atc.toggleHold(runways[0]);
    sim.step();
    assert.equal(runways[0].clearanceLight, 'RED');
    assert.equal(autopilot.state, LandingState.GO_AROUND);
    until(sim, () => autopilot.state === LandingState.INTERCEPT && autopilot.runway !== runways[0], 45);
    assert.ok(aircraft.position.y > previousAltitude + 120);
    assert.notEqual(finishLanding(sim).runway, runways[0].id);
  });
}

test('traffic vetoes a manual green override and clearance recovers when a conflict leaves', () => {
  const [runway] = createRunways();
  const atc = new AirspaceATC([runway]);
  runway.manualAtcOverride = 'GREEN';
  const npc = { position: runwayPoint(runway, -1610, 110, 80) };
  assert.ok(inRunwaySafetyZone(runway, npc.position));
  atc.update([npc]);
  assert.equal(runway.nearbyTrafficCount, 1);
  assert.equal(runway.clearanceLight, 'RED');
  npc.position.copy(runwayPoint(runway, -1610, 400, 80));
  atc.update([npc]);
  assert.equal(runway.clearanceLight, 'GREEN');
  atc.toggleHold(runway);
  atc.update([]);
  assert.equal(runway.clearanceLight, 'RED');
});

test('all-red airspace holds, then captures and lands when clearance returns', () => {
  const sim = simulation();
  const { runways, aircraft, autopilot } = sim;
  aircraft.positionForApproach(runways[0]);
  for (const runway of runways) runway.manualAtcOverride = 'RED';
  autopilot.toggle(aircraft);
  for (let n = 0; n < 600; n++) sim.step();
  assert.equal(autopilot.state, LandingState.SCANNING);
  assert.equal(autopilot.runway, null);
  runways[0].manualAtcOverride = null;
  finishLanding(sim, runways[0]);
});

test('civil circuits periodically occupy all three runways and clear afterward', () => {
  const { runways, traffic, atc } = simulation();
  const occupied = new Set();
  const cleared = new Set();
  for (let time = 0; time <= 260; time++) {
    traffic.update(time);
    atc.update(traffic.aircraft);
    for (const runway of runways) {
      if (runway.clearanceLight === 'RED') occupied.add(runway);
      else if (occupied.has(runway)) cleared.add(runway);
    }
  }
  assert.equal(occupied.size, runways.length);
  assert.equal(cleared.size, runways.length);
});
