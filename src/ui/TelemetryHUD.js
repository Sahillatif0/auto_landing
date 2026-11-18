import { GEAR_HEIGHT, KNOTS, radToDeg, runwayCoordinates } from '../physics/flightMath.js';
import { LandingState as State } from '../autopilot/AutonomousLandingController.js';
import { RadarMap } from './RadarMap.js';

const sequence = [State.SCANNING, State.INTERCEPT, State.FINAL, State.FLARE, State.ROLLOUT];
const labels = {
  [State.MANUAL]: 'Standby', [State.SCANNING]: 'Scanning / holding', [State.INTERCEPT]: 'Intercept',
  [State.FINAL]: 'Glideslope', [State.FLARE]: 'Flare', [State.ROLLOUT]: 'Rollout',
  [State.GO_AROUND]: 'Go-around', [State.COMPLETE]: 'Complete',
};
const signed = (value, digits) => (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(digits);
const padded = value => String(Math.round(value)).padStart(3, '0');

export class TelemetryHUD {
  constructor(runways, onAction) {
    this.elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
    this.stages = [...document.querySelectorAll('.sequence li')];
    this.rows = runways.map(runway => {
      const row = this.elements['runway-rows'].insertRow();
      row.title = runway.name;
      row.insertCell().textContent = runway.id;
      row.insertCell();
      row.insertCell();
      const badge = document.createElement('span');
      badge.className = 'badge';
      row.insertCell().append(badge);
      return { row, runway, badge };
    });
    this.radar = new RadarMap(this.elements, runways);
    this.visible = true;
    this.speedButtons = [...document.querySelectorAll('[data-simulation-speed]')];
    this.speedButtons.forEach(button => button.addEventListener('click', () =>
      onAction('simulation-speed', Number(button.dataset.simulationSpeed))));
    document.querySelectorAll('[data-action]').forEach(button =>
      button.addEventListener('click', () => onAction(button.dataset.action)));
  }

  toggle() {
    const button = this.elements['telemetry-button'];
    this.visible = !this.visible;
    this.elements.telemetry.hidden = !this.visible;
    this.elements['demo-controls'].hidden = !this.visible;
    button.classList.toggle('selected', this.visible);
    button.setAttribute('aria-pressed', String(this.visible));
  }

  text(id, value) {
    if (this.elements[id].textContent !== value) this.elements[id].textContent = value;
  }

  update(plane, autopilot, nearest, npcs, conflict, cameraName, simulationSpeed) {
    const runway = autopilot.runway ?? nearest;
    const { along, cross, agl } = runwayCoordinates(runway, plane.position);
    const phaseIndex = autopilot.state === State.COMPLETE ? sequence.length : sequence.indexOf(autopilot.state);
    const warning = autopilot.state === State.GO_AROUND;
    const throttle = Math.round(plane.throttle * 100);
    this.text('speed', padded(plane.speed * KNOTS));
    this.text('altitude', padded(Math.max(0, plane.position.y - GEAR_HEIGHT)));
    this.text('heading', padded((360 + Math.round(180 - radToDeg(plane.heading))) % 360) + '° HDG');
    this.text('aircraft-state', plane.state);
    this.text('gear', plane.gearDown ? 'GEAR DOWN' : 'GEAR UP');
    this.text('mode', autopilot.active ? 'AUTOLAND ACTIVE' : 'MANUAL');
    this.elements.mode.classList.toggle('active', autopilot.active);
    this.text('phase', labels[autopilot.state]);
    this.elements.phase.classList.toggle('warning', warning);
    this.stages.forEach((stage, i) => {
      stage.classList.toggle('current', i === phaseIndex);
      stage.classList.toggle('done', i < phaseIndex);
    });
    this.text('cross-track', autopilot.runway ? signed(cross, 1) + ' m' : '—');
    const deviation = radToDeg(Math.atan2(agl - GEAR_HEIGHT, runway.aimPoint - along)) - 3;
    this.text('glideslope', autopilot.runway && autopilot.active && along < runway.aimPoint ? signed(deviation, 2) + '°' : '—');
    this.text('sink-rate', Math.max(0, -plane.verticalSpeed).toFixed(1) + ' m/s');
    this.text('throttle-value', throttle + '%');
    this.elements['throttle-bar'].style.height = throttle + '%';
    this.elements['throttle-track'].setAttribute('aria-valuenow', throttle);
    this.text('camera-label', cameraName);
    const flightState = plane.state === 'AIRBORNE' ? 'FREE FLIGHT' : plane.state === 'STOPPED' ? 'FLIGHT STOPPED' : 'GROUND';
    const flightPhase = autopilot.active ? labels[autopilot.state].toUpperCase() : flightState;
    const rateLabel = autopilot.active && simulationSpeed > 1 ? '  /  ' + simulationSpeed + '×' : '';
    this.text('scene-indicator', runway.id + '  /  ' + flightPhase + rateLabel);
    this.speedButtons.forEach(button => button.setAttribute('aria-pressed',
      String(Number(button.dataset.simulationSpeed) === simulationSpeed)));
    this.text('demo-target', conflict ? 'TRAFFIC AT ' + conflict.runway.id : 'TARGET ' + runway.id);
    this.updateButton('autoland-button', autopilot.active ? 'Disengage autoland' : 'Engage autoland', autopilot.active);
    this.updateButton('traffic-button', conflict ? 'Clear traffic' : 'Spawn traffic', Boolean(conflict));
    this.updateButton('atc-button', runway.manualAtcOverride === 'RED' ? 'Release ATC hold' : 'ATC hold', runway.manualAtcOverride === 'RED');
    this.text('status-message', autopilot.state === State.COMPLETE ? '' : autopilot.message ||
      (plane.state === 'STOPPED' ? 'Aircraft stopped · use Runway reset to fly again' : ''));
    this.elements['status-message'].classList.toggle('warning', warning);
    this.elements['landing-summary'].hidden = autopilot.state !== State.COMPLETE;
    if (autopilot.state === State.COMPLETE) {
      this.text('landing-runway', autopilot.summary.runway);
      this.text('landing-sink', autopilot.summary.sinkRate.toFixed(2) + ' m/s');
      this.text('landing-offset', autopilot.summary.offset.toFixed(1) + ' m');
      this.text('landing-distance', autopilot.summary.stoppingDistance.toFixed(0) + ' m');
    }
    for (const { row, runway, badge } of this.rows) {
      row.classList.toggle('target', runway === autopilot.runway);
      row.cells[1].textContent = Math.round(runway.thresholdPos.distanceTo(plane.position)).toLocaleString('en-US') + ' m';
      row.cells[2].textContent = runway.nearbyTrafficCount;
      badge.textContent = runway.clearanceLight;
      badge.classList.toggle('red', runway.clearanceLight === 'RED');
    }
    this.radar.update(plane, npcs, autopilot, nearest);
  }

  updateButton(id, label, active) {
    const button = this.elements[id];
    button.querySelector('span').textContent = label;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('engaged', active);
  }
}
