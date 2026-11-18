import { clamp, radToDeg } from '../physics/flightMath.js';
import { LandingState } from '../autopilot/AutonomousLandingController.js';
import { inRunwaySafetyZone } from '../world/AirspaceATC.js';

const WIDTH = 340;
const HEIGHT = 205;
const CLEAR = '#6cebd1';
const BLOCKED = '#ff827b';
const TRAFFIC = '#ffc171';
const polygon = (points, x, z) => points.map(([east, south]) => x(east) + ',' + z(south)).join(' ');
const place = (node, x, y) => node.setAttribute('transform', `translate(${x} ${y})`);

function graphic(parent, kind, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', kind);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.append(node);
  return node;
}

function setLine(line, x1, y1, x2, y2) {
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
}

export class RadarMap {
  constructor(elements, runways) {
    this.elements = elements;
    this.runways = runways;
    this.range = 0;
    const points = runways.flatMap(runway => [runway.thresholdPos, runway.endPos]);
    this.bounds = { west: Math.min(...points.map(point => point.x)), east: Math.max(...points.map(point => point.x)),
      north: Math.min(...points.map(point => point.z)), south: Math.max(...points.map(point => point.z)) };
    const map = elements['radar-world'];
    this.landmarks = [
      { color: '#203439', points: [[-940, 2030], [6700, 2030], [6700, 7800], [-940, 7800]] },
      { color: '#2a4139', points: [[-1450, -460], [1180, -460], [1180, -40], [20, -40], [20, 380],
        [1350, 380], [920, 2025], [-1250, 2025], [-1250, 1120], [-1450, 1120]] },
    ].map(({ color, points }) => ({ points, shape: graphic(map, 'polygon', { fill: color }) }));
    this.safety = graphic(map, 'line', { 'stroke-linecap': 'round', opacity: 0.12 });
    this.route = graphic(map, 'polyline', { fill: 'none', stroke: '#8cefdc', 'stroke-width': 1.7,
      'stroke-dasharray': '5 4', 'stroke-linecap': 'round' });
    this.airfields = runways.map(runway => {
      const mark = graphic(map, 'line', { 'stroke-width': 4, 'stroke-linecap': 'round' });
      graphic(mark, 'title').textContent = runway.name;
      const centerline = graphic(map, 'line', { stroke: '#142825', 'stroke-width': 1, 'stroke-dasharray': '3 3' });
      const label = graphic(map, 'text', { class: 'radar-runway' });
      label.textContent = runway.id.slice(4);
      return { runway, mark, centerline, label };
    });
    this.contacts = [];
    this.track = graphic(elements['radar-aircraft-track'], 'line', { stroke: CLEAR, opacity: 0.5,
      'stroke-width': 1.3, 'stroke-dasharray': '3 4' });

    const rangeButtons = [...document.querySelectorAll('[data-radar-range]')];
    for (const button of rangeButtons) button.addEventListener('click', () => {
      this.range = Number(button.dataset.radarRange);
      for (const preset of rangeButtons) preset.setAttribute('aria-pressed', String(preset === button));
    });
  }

  viewport(position) {
    if (this.range) return { x: position.x, z: position.z, scale: WIDTH / this.range };
    const west = Math.min(this.bounds.west, position.x), east = Math.max(this.bounds.east, position.x);
    const north = Math.min(this.bounds.north, position.z), south = Math.max(this.bounds.south, position.z);
    return { x: (west + east) / 2, z: (north + south) / 2,
      scale: Math.min((WIDTH - 54) / (east - west), (HEIGHT - 34) / (south - north)) };
  }

  update(plane, npcs, autopilot, nearest) {
    const { scale, x: centerX, z: centerZ } = this.viewport(plane.position);
    const x = east => WIDTH / 2 + (east - centerX) * scale;
    const z = south => HEIGHT / 2 + (south - centerZ) * scale;
    const focus = autopilot.active && autopilot.runway ? autopilot.runway : nearest;
    const ownX = x(plane.position.x), ownY = z(plane.position.z);
    const gridSize = 1000 * scale;
    const grid = this.elements['radar-grid'];
    grid.setAttribute('width', gridSize);
    grid.setAttribute('height', gridSize);
    grid.setAttribute('patternTransform', `translate(${x(0)} ${z(0)})`);
    this.elements['radar-grid-lines'].setAttribute('d', `M0 0H${gridSize} M0 0V${gridSize}`);
    for (const { points, shape } of this.landmarks) shape.setAttribute('points', polygon(points, x, z));

    const { thresholdPos: start, endPos: end, headingVec: heading } = focus;
    const color = focus.clearanceLight === 'GREEN' ? CLEAR : BLOCKED;
    setLine(this.safety, x(start.x), z(start.z), x(end.x), z(end.z));
    this.safety.setAttribute('stroke', color);
    this.safety.setAttribute('stroke-width', focus.safetyRadius * 2 * scale);

    const showApproach = autopilot.state === LandingState.INTERCEPT || autopilot.state === LandingState.FINAL ||
      autopilot.state === LandingState.FLARE;
    const centerline = [[start.x - heading.x * 1500, start.z - heading.z * 1500], [start.x, start.z]];
    const approachPoints = autopilot.route ? autopilot.route.slice(autopilot.routeIndex).map(point => [point.x, point.z]) : [];
    this.route.setAttribute('points', showApproach ? polygon([...approachPoints, ...centerline], x, z) : '');

    for (const { runway, mark, centerline: dashes, label } of this.airfields) {
      const from = runway.thresholdPos, to = runway.endPos;
      const x1 = x(from.x), y1 = z(from.z), x2 = x(to.x), y2 = z(to.z);
      setLine(mark, x1, y1, x2, y2);
      setLine(dashes, x1, y1, x2, y2);
      mark.setAttribute('stroke', runway.clearanceLight === 'GREEN' ? CLEAR : BLOCKED);
      mark.setAttribute('stroke-width', runway === focus ? 5 : 3);
      label.setAttribute('x', (x1 + x2) / 2 + (Math.abs(runway.headingVec.z) > 0.5 ? 9 : -10));
      label.setAttribute('y', (y1 + y2) / 2 - 7);
    }

    const trackLength = clamp(plane.speed * 12, 0, 1400) * scale;
    setLine(this.track, ownX, ownY, ownX + Math.sin(plane.heading) * trackLength, ownY + Math.cos(plane.heading) * trackLength);
    const ownship = this.elements['radar-aircraft'];
    ownship.setAttribute('transform', `translate(${ownX} ${ownY}) rotate(${180 - radToDeg(plane.heading)})`);
    this.updateContacts(npcs, x, z);

    const meters = this.range === 2000 ? 500 : 1000;
    const barEnd = 16 + meters * scale;
    this.elements['radar-scale-line'].setAttribute('d', `M16 186v4H${barEnd}v-4`);
    this.elements['radar-scale-label'].textContent = meters === 500 ? '500 m' : '1 km';
  }

  updateContacts(npcs, x, z) {
    while (this.contacts.length < npcs.length) {
      const mark = graphic(this.elements['radar-traffic'], 'g');
      const tail = graphic(mark, 'path', { d: 'M0 -5L4 0 0 5 -4 0Z', 'stroke-width': 1 });
      const title = graphic(mark, 'title');
      this.contacts.push({ mark, tail, title });
    }
    this.contacts.forEach(({ mark, tail, title }, index) => {
      const npc = npcs[index];
      const conflicts = npc && this.runways.find(runway => inRunwaySafetyZone(runway, npc.position));
      mark.setAttribute('visibility', npc ? 'visible' : 'hidden');
      if (!npc) return;
      place(mark, x(npc.position.x), z(npc.position.z));
      tail.setAttribute('fill', conflicts ? BLOCKED : TRAFFIC);
      tail.setAttribute('stroke', conflicts ? '#ffd1c8' : '#483423');
      title.textContent = npc.name + (conflicts ? ' · ' + conflicts.id + ' traffic' : '');
    });
  }
}
