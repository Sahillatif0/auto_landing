import { GEAR_HEIGHT, KNOTS, radToDeg, runwayCoordinates } from '../physics/flightMath.js';
import { LandingState as State } from '../autopilot/AutonomousLandingController.js';
import { RadarMap } from './RadarMap.js';

const sequence = [State.SCANNING, State.INTERCEPT, State.FINAL, State.FLARE, State.ROLLOUT];
const labels = {
  [State.MANUAL]: 'Standby', [State.SCANNING]: 'Scanning / holding', [State.INTERCEPT]: 'Intercept',
  [State.FINAL]: 'Glideslope', [State.FLARE]: 'Flare', [State.ROLLOUT]: 'Rollout',
  [State.GO_AROUND]: 'Go-around', [State.COMPLETE]: 'Complete',
};
const stateLabels = {
  GROUNDED: 'Grounded',
  AIRBORNE: 'Airborne',
  STOPPED: 'Stopped',
};
const signed = (value, digits) => (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(digits);
const paddedHeading = value => String(Math.round(value)).padStart(3, '0');

export class TelemetryHUD {
  constructor(runways, onAction) {
    this.elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
    this.stages = [...document.querySelectorAll('.sequence li')];
    this.rows = runways.map(runway => {
      const row = this.elements['runway-rows'].insertRow();
      row.title = runway.name;
      const idCell = row.insertCell();
      idCell.className = 'num';
      idCell.textContent = runway.id;
      const distCell = row.insertCell();
      distCell.className = 'num';
      const trafficCell = row.insertCell();
      trafficCell.className = 'num';
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
    this.bindShortcuts();
  }

  bindShortcuts() {
    const sheet = this.elements.shortcuts;
    const button = this.elements['shortcuts-button'];
    const set = open => {
      sheet.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      button.classList.toggle('selected', open);
    };
    this.toggleShortcuts = () => set(sheet.hidden);
    button.addEventListener('click', () => set(sheet.hidden));
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || sheet.hidden) return;
      set(false);
      button.focus();
    });
    document.addEventListener('pointerdown', event => {
      if (sheet.hidden || sheet.contains(event.target) || button.contains(event.target)) return;
      set(false);
    });
  }

  toggle() {
    const button = this.elements['telemetry-button'];
    this.visible = !this.visible;
    this.elements.simulator.classList.toggle('hud-hidden', !this.visible);
    button.classList.toggle('selected', this.visible);
    button.setAttribute('aria-pressed', String(this.visible));
    button.title = (this.visible ? 'Hide' : 'Show') + ' HUD (H)';
  }

  text(id, value) {
    if (this.elements[id].textContent !== value) this.elements[id].textContent = value;
  }

  update(plane, autopilot, takeoff, nearest, npcs, conflict, cameraName, simulationSpeed) {
    const runway = takeoff.runway ?? autopilot.runway ?? nearest;
    const { along, cross, agl } = runwayCoordinates(runway, plane.position);
    const phaseIndex = autopilot.state === State.COMPLETE ? sequence.length : sequence.indexOf(autopilot.state);
    const warning = autopilot.state === State.GO_AROUND;
    const throttle = Math.round(plane.throttle * 100);
    this.text('speed', String(Math.round(plane.speed * KNOTS)));
    this.text('altitude', String(Math.round(Math.max(0, plane.position.y - GEAR_HEIGHT))));
    this.text('heading', paddedHeading((360 + Math.round(180 - radToDeg(plane.heading))) % 360) + '°');
    this.text('aircraft-state', stateLabels[plane.state] ?? plane.state);
    this.text('gear', plane.gearDown ? 'Gear down' : 'Gear up');
    this.text('mode', takeoff.active ? 'Auto takeoff' : autopilot.active ? 'Autoland' : 'Manual');
    this.elements.mode.classList.toggle('active', autopilot.active || takeoff.active);
    this.text('phase', takeoff.active ? takeoff.phase : labels[autopilot.state]);
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
    this.elements['throttle-bar'].style.transform = `scaleY(${throttle / 100})`;
    this.elements['throttle-track'].setAttribute('aria-valuenow', throttle);
    const cameraButton = this.elements['camera-button'];
    cameraButton.title = cameraName + ' (C)';
    cameraButton.setAttribute('aria-label', 'Camera: ' + cameraName);
    const flightState = plane.state === 'AIRBORNE' ? 'Free flight' : plane.state === 'STOPPED' ? 'Flight stopped' : 'Ground';
    const flightPhase = takeoff.active ? takeoff.phase : autopilot.active ? labels[autopilot.state] : flightState;
    const rateLabel = autopilot.active && simulationSpeed > 1 ? ' · ' + simulationSpeed + '×' : '';
    this.text('scene-indicator', runway.id + ' · ' + flightPhase + rateLabel);
    this.speedButtons.forEach(button => button.setAttribute('aria-pressed',
      String(Number(button.dataset.simulationSpeed) === simulationSpeed)));
    this.updateButton('autoland-button', autopilot.active ? 'Disengage autoland' : 'Engage autoland', autopilot.active);
    this.updateButton('takeoff-button', takeoff.active ? 'Disengage takeoff' : 'Auto takeoff', takeoff.active);
    this.elements['autoland-button'].disabled = takeoff.active;
    this.elements['takeoff-button'].disabled = autopilot.active;
    this.updateButton('traffic-button', conflict ? 'Clear traffic' : 'Spawn traffic', Boolean(conflict));
    this.updateButton('atc-button', runway.manualAtcOverride === 'RED' ? 'Release ATC hold' : 'ATC hold', runway.manualAtcOverride === 'RED');
    const landingMessage = autopilot.state === State.COMPLETE ? '' : autopilot.message;
    const message = autopilot.active ? landingMessage : takeoff.message || landingMessage;
    const stopped = plane.state === 'STOPPED' && autopilot.state !== State.COMPLETE;
    this.text('status-message', message || (stopped ? 'Aircraft stopped · use Reset to fly again' : ''));
    this.elements['status-message'].classList.toggle('warning', warning);
    this.elements['landing-summary'].hidden = autopilot.state !== State.COMPLETE;
    if (autopilot.state === State.COMPLETE) {
      this.text('landing-runway', autopilot.summary.runway);
      this.text('landing-sink', autopilot.summary.sinkRate.toFixed(2) + ' m/s');
      this.text('landing-offset', autopilot.summary.offset.toFixed(1) + ' m');
      this.text('landing-distance', autopilot.summary.stoppingDistance.toFixed(0) + ' m');
    }
    for (const { row, runway, badge } of this.rows) {
      row.classList.toggle('target', runway === (takeoff.runway ?? autopilot.runway));
      row.cells[1].textContent = Math.round(runway.thresholdPos.distanceTo(plane.position)).toLocaleString('en-US') + ' m';
      row.cells[2].textContent = runway.nearbyTrafficCount;
      badge.textContent = runway.clearanceLight === 'GREEN' ? 'Clear' : 'Hold';
      badge.classList.toggle('red', runway.clearanceLight === 'RED');
    }
    this.radar.update(plane, npcs, autopilot, takeoff.runway ?? nearest);
  }

  updateButton(id, label, active) {
    const button = this.elements[id];
    const caption = button.querySelector('span');
    if (caption.textContent !== label) caption.textContent = label;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('engaged', active);
  }
}
