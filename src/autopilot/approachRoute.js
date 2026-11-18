import { Vector3 } from 'three';
import { angleDelta } from '../physics/flightMath.js';

const TURN_RADIUS = 490;
const TAU = Math.PI * 2;
const wrap = angle => (angle % TAU + TAU) % TAU;

// Dubins paths use straight segments and constant-radius turns. In this plane,
// an angle of zero points along +X and a left turn increases the angle toward +Z.
function paths(a, b, d) {
  const sa = Math.sin(a), sb = Math.sin(b), ca = Math.cos(a), cb = Math.cos(b);
  const cosAB = Math.cos(a - b);
  const candidates = [];
  function straight(pattern, square, offset, turns) {
    if (square < 0) return;
    const length = Math.sqrt(square);
    const [first, last] = turns(offset(length));
    candidates.push({ pattern, segments: [wrap(first), length, wrap(last)] });
  }
  straight('LSL', 2 + d * d - 2 * cosAB + 2 * d * (sa - sb),
    () => Math.atan2(cb - ca, d + sa - sb), t => [t - a, b - t]);
  straight('RSR', 2 + d * d - 2 * cosAB + 2 * d * (sb - sa),
    () => Math.atan2(ca - cb, d - sa + sb), t => [a - t, t - b]);
  straight('LSR', -2 + d * d + 2 * cosAB + 2 * d * (sa + sb),
    p => Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p), t => [t - a, t - b]);
  straight('RSL', d * d - 2 + 2 * cosAB - 2 * d * (sa + sb),
    p => Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p), t => [a - t, b - t]);

  const rlr = (6 - d * d + 2 * cosAB + 2 * d * (sa - sb)) / 8;
  if (Math.abs(rlr) <= 1) {
    const p = wrap(TAU - Math.acos(rlr));
    const t = wrap(a - Math.atan2(ca - cb, d - sa + sb) + p / 2);
    candidates.push({ pattern: 'RLR', segments: [t, p, wrap(a - b - t + p)] });
  }
  const lrl = (6 - d * d + 2 * cosAB + 2 * d * (sb - sa)) / 8;
  if (Math.abs(lrl) <= 1) {
    const p = wrap(TAU - Math.acos(lrl));
    const t = wrap(-a - Math.atan2(ca - cb, d + sa - sb) + p / 2);
    candidates.push({ pattern: 'LRL', segments: [t, p, wrap(b - a - t + p)] });
  }
  return candidates;
}

export function planRoute(start, heading, end, endHeading) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const bearing = Math.atan2(dz, dx);
  let angle = Math.PI / 2 - heading;
  const finish = Math.PI / 2 - endHeading;
  const cost = path => path.segments.reduce((sum, part) => sum + part, 0);
  const path = paths(wrap(angle - bearing), wrap(finish - bearing), Math.hypot(dx, dz) / TURN_RADIUS)
    .reduce((best, candidate) => cost(candidate) < cost(best) ? candidate : best);
  const points = [start.clone()];
  let x = start.x, z = start.z;
  path.segments.forEach((length, index) => {
    const type = path.pattern[index];
    const steps = Math.max(1, Math.ceil(length * TURN_RADIUS / 29));
    const step = length / steps;
    for (let n = 0; n < steps; n++) {
      if (type === 'S') {
        x += Math.cos(angle) * step * TURN_RADIUS;
        z += Math.sin(angle) * step * TURN_RADIUS;
      } else {
        const direction = type === 'L' ? 1 : -1;
        const next = angle + direction * step;
        x += (Math.sin(next) - Math.sin(angle)) * TURN_RADIUS * direction;
        z += (Math.cos(angle) - Math.cos(next)) * TURN_RADIUS * direction;
        angle = next;
      }
      points.push(new Vector3(x, start.y, z));
    }
  });
  points[points.length - 1].copy(end);
  return points;
}

export function advanceRoute(points, index, position) {
  const distance = p => Math.hypot(p.x - position.x, p.z - position.z);
  while (index + 1 < points.length && distance(points[index + 1]) <= distance(points[index]) + 0.001) index++;
  return index;
}

export function runwayAlignment(runway, cross, lookahead, maxCorrection) {
  return runway.heading + Math.max(-maxCorrection, Math.min(maxCorrection, Math.atan2(cross, lookahead)));
}

export function alignedForFinal(plane, runway, coordinates) {
  const { along, cross } = coordinates;
  return along >= -1460 && along < -430 && Math.abs(cross) < 32 &&
    Math.abs(angleDelta(runway.heading, plane.heading)) < 0.14;
}
