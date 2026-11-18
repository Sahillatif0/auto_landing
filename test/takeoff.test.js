import test from 'node:test';
import assert from 'node:assert/strict';
import { AutonomousTakeoffController } from '../src/autopilot/AutonomousTakeoffController.js';
import { GroundTakeoffPhysics } from '../src/physics/GroundTakeoffPhysics.js';
import { GEAR_HEIGHT, KNOTS, runwayCoordinates, runwayPoint } from '../src/physics/flightMath.js';
import { SIMULATION_STEP } from '../src/physics/SimulationClock.js';
import { AirspaceATC } from '../src/world/AirspaceATC.js';
import { createRunways } from '../src/world/runways.js';

test('auto takeoff holds for ATC, rejects an uncleared roll, then climbs and hands back control', () => {
  const runways = createRunways();
  const [runway] = runways;
  const plane = new GroundTakeoffPhysics(runways);
  const atc = new AirspaceATC(runways);
  const takeoff = new AutonomousTakeoffController(runways);
  const step = () => {
    atc.update([]);
    plane.update(SIMULATION_STEP, takeoff.command(plane));
    takeoff.observe(plane);
  };

  atc.toggleHold(runway);
  takeoff.toggle(plane);
  for (let i = 0; i < 60; i++) step();
  assert.equal(plane.speed, 0);
  assert.equal(takeoff.phase, 'Waiting for clearance');

  atc.toggleHold(runway);
  for (let i = 0; i < 180; i++) step();
  assert.equal(takeoff.phase, 'Ground roll');
  assert.ok(plane.speed > 10);
  atc.toggleHold(runway);
  for (let i = 0; i < 360; i++) step();
  assert.equal(plane.speed, 0);
  assert.equal(plane.state, 'GROUNDED');

  atc.toggleHold(runway);
  let liftoff = null;
  for (let i = 0; takeoff.active && i < 2400; i++) {
    step();
    if (!liftoff && plane.state === 'AIRBORNE') {
      liftoff = { speed: plane.speed, coordinates: runwayCoordinates(runway, plane.position) };
    }
  }
  assert.ok(liftoff);
  assert.ok(liftoff.speed * KNOTS >= 130);
  assert.ok(Math.abs(liftoff.coordinates.cross) < 0.5);
  assert.equal(plane.gearDown, false);
  assert.ok(plane.position.y - GEAR_HEIGHT >= 120);
  assert.equal(takeoff.active, false);
  assert.match(takeoff.message, /manual control/);
});

test('auto takeoff stays disarmed when too little runway remains or the aircraft is airborne', () => {
  const runways = createRunways();
  const [runway] = runways;
  const plane = new GroundTakeoffPhysics(runways);
  const takeoff = new AutonomousTakeoffController(runways);
  plane.position.copy(runwayPoint(runway, runway.length - 200, GEAR_HEIGHT));
  takeoff.toggle(plane);
  assert.equal(takeoff.active, false);
  plane.positionForApproach(runway);
  takeoff.toggle(plane);
  assert.equal(takeoff.active, false);
});
