import { clamp, runwayCoordinates } from '../physics/flightMath.js';

export function inRunwaySafetyZone(runway, aircraftPosition) {
  const { along, cross, agl } = runwayCoordinates(runway, aircraftPosition);
  const nearestSurface = clamp(along, 0, runway.length);
  const radius = Math.hypot(along - nearestSurface, cross, agl) <= runway.safetyRadius;
  const approach = along >= -1800 && along < 0 && agl >= -5 && agl <= 310 &&
    Math.abs(cross) <= 110 - along * 0.075;
  return radius || approach;
}

export class AirspaceATC {
  constructor(runways) {
    this.runways = runways;
  }

  update(npcs) {
    for (const runway of this.runways) {
      runway.nearbyTrafficCount = npcs.reduce((count, npc) => count + Number(inRunwaySafetyZone(runway, npc.position)), 0);
      runway.clearanceLight = runway.nearbyTrafficCount === 0 && runway.manualAtcOverride !== 'RED' ? 'GREEN' : 'RED';
    }
  }

  toggleHold(runway) {
    runway.manualAtcOverride = runway.manualAtcOverride === 'RED' ? 'GREEN' : 'RED';
  }

  nearest(position) {
    return this.runways.reduce((best, runway) =>
      runway.thresholdPos.distanceToSquared(position) < best.thresholdPos.distanceToSquared(position) ? runway : best);
  }
}
