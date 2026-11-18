import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOLAND_SPEEDS, SIMULATION_STEP, SimulationClock } from '../src/physics/SimulationClock.js';

test('every autoland speed changes step frequency while preserving the physics timestep', () => {
  for (const speed of AUTOLAND_SPEEDS) {
    const clock = new SimulationClock();
    clock.setSpeed(speed);
    let steps = 0;
    for (let frame = 0; frame < 60; frame++) {
      clock.advance(1 / 60, () => true, step => {
        assert.equal(step, SIMULATION_STEP);
        steps++;
      });
    }
    assert.equal(steps, 60 * speed);
  }
});

test('completion restores manual time inside the same frame', () => {
  const clock = new SimulationClock();
  clock.setSpeed(8);
  let steps = 0;
  clock.advance(SIMULATION_STEP, () => steps < 1, () => steps++);
  assert.equal(steps, 1);
  clock.advance(SIMULATION_STEP, () => false, () => steps++);
  assert.equal(steps, 2);
  assert.equal(clock.activeSpeed(false), 1);
});

test('reset clears pending time and keeps the selected speed', () => {
  const clock = new SimulationClock();
  clock.setSpeed(4);
  clock.advance(SIMULATION_STEP / 8, () => true, () => assert.fail('Unexpected step'));
  clock.reset();
  clock.advance(SIMULATION_STEP / 8, () => true, () => assert.fail('Unexpected step'));
  assert.equal(clock.activeSpeed(true), 4);
});
