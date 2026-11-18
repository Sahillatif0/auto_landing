export const SIMULATION_STEP = 1 / 60;
export const SIMULATION_SPEEDS = [1, 2, 4, 8];

export class SimulationClock {
  constructor() {
    this.speed = 1;
    this.reset();
  }

  reset() {
    this.remainingTime = 0;
  }

  setSpeed(speed) {
    if (SIMULATION_SPEEDS.includes(speed)) this.speed = speed;
  }

  activeSpeed() {
    return this.speed;
  }

  advance(seconds, tick) {
    this.remainingTime += Math.min(seconds, 0.125);
    const stepDuration = SIMULATION_STEP / this.speed;
    while (this.remainingTime + 1e-10 >= stepDuration) {
      this.remainingTime = Math.max(0, this.remainingTime - stepDuration);
      tick(SIMULATION_STEP);
    }
    return this.remainingTime / stepDuration;
  }
}
