import { MathUtils, Vector3 } from 'three';

export const { clamp, degToRad, radToDeg } = MathUtils;
export const KNOTS = 1.943844;
export const GEAR_HEIGHT = 2.05;
export const GLIDE_ANGLE = degToRad(3);
export const GLIDE_SLOPE = Math.tan(GLIDE_ANGLE);
export const V_REF = 130 / KNOTS;

export const angleDelta = (target, actual) => Math.atan2(Math.sin(target - actual), Math.cos(target - actual));
export const headingTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
export const damp = (current, target, rate, dt) => MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));

export function runwayPoint(runway, along, height = 0, cross = 0) {
  return runway.thresholdPos.clone().addScaledVector(runway.headingVec, along)
    .addScaledVector(runway.right, cross).add(new Vector3(0, height, 0));
}

export function runwayCoordinates(runway, position) {
  const x = position.x - runway.thresholdPos.x;
  const z = position.z - runway.thresholdPos.z;
  return {
    along: x * runway.headingVec.x + z * runway.headingVec.z,
    cross: x * runway.right.x + z * runway.right.z,
    agl: position.y - runway.thresholdPos.y,
  };
}

export function glideHeight(runway, along) {
  return GEAR_HEIGHT + Math.max(0, runway.aimPoint - along) * GLIDE_SLOPE;
}
