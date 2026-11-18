export const SIMULATION_STEP = 1 / 60;
export const AUTOLAND_SPEEDS = [1, 2, 4, 8];

export class SimulationClock {
  constructor() {
    this.speed = 1;
    this.reset();
  }

  reset() {
    this.remainingTime = 0;
  }

  setSpeed(speed) {
    if (AUTOLAND_SPEEDS.includes(speed)) this.speed = speed;
  }

  activeSpeed(autolandActive) {
    return autolandActive ? this.speed : 1;
  }

  advance(seconds, isAutolandActive, tick) {
    this.remainingTime += Math.min(seconds, 0.125);
    // Keep time in real seconds so finishing autoland can restore 1× during this frame.
    let stepDuration = SIMULATION_STEP / this.activeSpeed(isAutolandActive());
    while (this.remainingTime + 1e-10 >= stepDuration) {
      this.remainingTime = Math.max(0, this.remainingTime - stepDuration);
      tick(SIMULATION_STEP);
      stepDuration = SIMULATION_STEP / this.activeSpeed(isAutolandActive());
    }
    return this.remainingTime / stepDuration;
  }
}
