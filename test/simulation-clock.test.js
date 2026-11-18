import test from 'node:test';
import assert from 'node:assert/strict';
import { SIMULATION_SPEEDS, SIMULATION_STEP, SimulationClock } from '../src/physics/SimulationClock.js';

test('every simulation speed changes step frequency while preserving the physics timestep', () => {
  for (const speed of SIMULATION_SPEEDS) {
    const clock = new SimulationClock();
    clock.setSpeed(speed);
    let steps = 0;
    for (let frame = 0; frame < 60; frame++) {
      clock.advance(1 / 60, step => {
        assert.equal(step, SIMULATION_STEP);
        steps++;
      });
    }
    assert.equal(steps, 60 * speed);
  }
});

test('the selected speed applies to manual flight as well as autoland', () => {
  const clock = new SimulationClock();
  clock.setSpeed(4);
  let steps = 0;
  clock.advance(SIMULATION_STEP, () => steps++);
  assert.equal(steps, 4);
  assert.equal(clock.activeSpeed(), 4);
});

test('reset clears pending time and keeps the selected speed', () => {
  const clock = new SimulationClock();
  clock.setSpeed(4);
  clock.advance(SIMULATION_STEP / 8, () => assert.fail('Unexpected step'));
  clock.reset();
  clock.advance(SIMULATION_STEP / 8, () => assert.fail('Unexpected step'));
  assert.equal(clock.activeSpeed(), 4);
});
