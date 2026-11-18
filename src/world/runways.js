import { Vector3 } from 'three';
import { runwayCoordinates } from '../physics/flightMath.js';

export function createRunways() {
  return [
    { id: 'RWY-09L', name: 'Main International', x: -1750, z: -650, dx: 1, dz: 0, length: 2540, width: 64 },
    { id: 'RWY-27R', name: 'Downtown City Strip', x: 1720, z: 125, dx: -1, dz: 0, length: 1560, width: 52 },
    { id: 'RWY-18C', name: 'Industrial Airfield', x: -1530, z: 1370, dx: 0, dz: 1, length: 1940, width: 56 },
  ].map(({ x, z, dx, dz, ...runway }) => {
    const thresholdPos = new Vector3(x, 0, z);
    const headingVec = new Vector3(dx, 0, dz);
    return {
      ...runway, thresholdPos, headingVec,
      endPos: thresholdPos.clone().addScaledVector(headingVec, runway.length),
      right: new Vector3(-dz, 0, dx), heading: Math.atan2(dx, dz),
      safetyRadius: 800, aimPoint: 305, nearbyTrafficCount: 0,
      manualAtcOverride: null, clearanceLight: 'GREEN',
    };
  });
}

export function surfaceRunway(runways, position) {
  return runways.find(runway => {
    const { along, cross } = runwayCoordinates(runway, position);
    return along >= 0 && along <= runway.length && Math.abs(cross) <= runway.width / 2;
  }) ?? null;
}
