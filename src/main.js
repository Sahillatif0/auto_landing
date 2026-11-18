import * as THREE from 'three';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './style.css';
import { GroundTakeoffPhysics } from './physics/GroundTakeoffPhysics.js';
import { AUTOLAND_SPEEDS, SIMULATION_STEP, SimulationClock } from './physics/SimulationClock.js';
import { GEAR_HEIGHT, clamp, degToRad } from './physics/flightMath.js';
import { AutonomousLandingController } from './autopilot/AutonomousLandingController.js';
import { createRunways } from './world/runways.js';
import { CityAndAirports } from './world/CityAndAirports.js';
import { AirspaceATC } from './world/AirspaceATC.js';
import { AircraftVisual } from './world/AircraftVisual.js';
import { NPCSystem } from './systems/npcSystem.js';
import { TelemetryHUD } from './ui/TelemetryHUD.js';

const view = document.querySelector('#flight-view');
const loading = document.querySelector('#loading');

function start(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.17;
  view.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9b8d99, 0.000118);
  scene.add(new THREE.HemisphereLight(0xd5defe, 0x62585c, 2.10));
  const sun = new THREE.DirectionalLight(0xffceb1, 3.1);
  sun.position.set(880, 400, 785);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x7fb6e3, 0.76);
  rim.position.set(-800,180,-550);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(57, 1, 0.42, 43500);
  const runways = createRunways();
  const world = new CityAndAirports(scene, runways);
  const plane = new GroundTakeoffPhysics(runways);
  const autopilot = new AutonomousLandingController(runways);
  const clock = new SimulationClock();
  const autolandActive = () => autopilot.active;
  const traffic = new NPCSystem(scene, runways);
  const atc = new AirspaceATC(runways);
  const aircraft = new AircraftVisual(scene, { player: true });
  const shadow = makeShadow(scene);
  const keys = new Set();
  const reticle = document.querySelector('.target-reticle');
  const cameraModes = ['Chase cam', 'Nose cam', 'Wide cam'];
  let cameraMode = 0;
  let cameraReset = true;
  let time = 0;
  let throttle = 0;
  let manualGear = true;
  let previousFrame = 0;
  let hudAge = 1;
  let boost = false;
  const desired = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const cameraFocus = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const side = new THREE.Vector3();
  const projection = new THREE.Vector3();

  function reset(airborne) {
    autopilot.reset();
    traffic.clearConflict();
    for (const runway of runways) runway.manualAtcOverride = null;
    time = 0;
    clock.reset();
    traffic.update(time);
    if (airborne) plane.positionForApproach(runways[0]);
    else plane.spawn(runways[0]);
    throttle = plane.throttle;
    manualGear = true;
    cameraReset = true;
    keys.clear();
  }

  function action(name, value) {
    const runway = autopilot.runway ?? atc.nearest(plane.position);
    switch (name) {
      case 'autoland':
        autopilot.toggle(plane);
        throttle = plane.throttle;
        manualGear = plane.gearDown;
        break;
      case 'traffic': traffic.toggleConflict(runway); break;
      case 'atc': atc.toggleHold(runway); break;
      case 'reset': reset(false); break;
      case 'airborne': reset(true); break;
      case 'gear': if (plane.state === 'AIRBORNE' && !autopilot.active) manualGear = !manualGear; break;
      case 'camera':
        cameraMode = (cameraMode + 1) % cameraModes.length;
        cameraReset = true;
        break;
      case 'telemetry': hud.toggle(); break;
      case 'simulation-speed': clock.setSpeed(value); break;
      case 'cycle-speed': {
        const next = (AUTOLAND_SPEEDS.indexOf(clock.speed) + 1) % AUTOLAND_SPEEDS.length;
        clock.setSpeed(AUTOLAND_SPEEDS[next]);
        break;
      }
    }
    atc.update(traffic.aircraft);
    hudAge = 1;
  }

  const hud = new TelemetryHUD(runways, action);
  const actions = { KeyL: 'autoland', KeyT: 'traffic', KeyG: 'atc', KeyR: 'reset', KeyF: 'airborne',
    KeyV: 'gear', KeyC: 'camera', KeyH: 'telemetry', KeyM: 'cycle-speed' };
  const controlKeys = new Set(['KeyW','ArrowUp','KeyS','ArrowDown','KeyA','KeyD','KeyQ','KeyE','ArrowLeft','ArrowRight',
    'Space','KeyX','ShiftLeft','ShiftRight']);

  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement && event.target.matches(':focus-visible')) return;
    if (controlKeys.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    } else if (actions[event.code] && !event.repeat) {
      event.preventDefault();
      action(actions[event.code]);
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { previousFrame = 0; clock.reset(); });

  const has = (...codes) => codes.some(code => keys.has(code));
  function manualCommand(dt) {
    const up = has('KeyW','ArrowUp'), down = has('KeyS','ArrowDown');
    const onGround = plane.state === 'GROUNDED';
    const brake = onGround && down ? 1 : 0;
    if (onGround) throttle = up && !brake ? Math.min(1, throttle + dt * 1.65) : Math.max(0, throttle - dt * (brake ? 3.2 : 0.96));
    else throttle = clamp(throttle + (Number(up) - Number(down)) * dt * 0.64, 0, 1);
    const bank = Number(has('KeyA','ArrowLeft')) - Number(has('KeyD','ArrowRight'));
    const rudder = Number(has('KeyQ')) - Number(has('KeyE'));
    const pitch = Number(has('Space')) - Number(has('KeyX'));
    boost = !onGround && has('ShiftLeft','ShiftRight');
    return { throttle, brake, pitch, roll: bank, yaw: onGround ? clamp(bank + rudder,-1,1) : rudder,
      gearDown: onGround || manualGear, boost };
  }

  function updateCamera(dt) {
    heading.set(Math.sin(plane.heading),0,Math.cos(plane.heading));
    side.set(heading.z,0,-heading.x);
    const onGround = plane.state !== 'AIRBORNE';
    desired.copy(plane.position);
    focus.copy(plane.position);
    if (cameraMode === 1) {
      desired.addScaledVector(heading,7.8).y += 1.15;
      focus.addScaledVector(heading,105).y += Math.sin(plane.pitch)*78 + 1;
    } else if (cameraMode === 2) {
      desired.addScaledVector(heading,-86).addScaledVector(side,44).y += 36;
      focus.addScaledVector(heading,34).y += 3;
    } else {
      desired.addScaledVector(heading, -36).addScaledVector(side, onGround ? 12 : 8).y += onGround ? 9.4 : 10.4;
      focus.addScaledVector(heading, 39).addScaledVector(side,7).y += onGround ? 4.2 : Math.sin(plane.pitch)*13;
    }
    desired.y = Math.max(desired.y, 2.65);
    const amount = cameraReset ? 1 : 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(desired, amount);
    cameraFocus.lerp(focus, amount);
    camera.lookAt(cameraFocus);
    camera.updateMatrixWorld();
    cameraReset = false;
    projection.copy(plane.position).addScaledVector(heading,180);
    projection.y += Math.max(1, Math.sin(plane.pitch) * 180);
    projection.project(camera);
    reticle.style.left = (50 + projection.x * 50) + '%';
    reticle.style.top = (50 - projection.y * 50) + '%';
    reticle.hidden = Math.abs(projection.x) > 1 || Math.abs(projection.y) > 1;
  }

  function resize() {
    camera.aspect = view.clientWidth / view.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(view.clientWidth, view.clientHeight);
  }
  new ResizeObserver(resize).observe(view);
  resize();

  function tick(step) {
    time += step;
    traffic.update(time);
    atc.update(traffic.aircraft);
    const command = autopilot.command(plane, step);
    if (command) {
      boost = false;
      throttle = plane.throttle;
      manualGear = command.gearDown;
    }
    plane.update(step, command ?? manualCommand(step));
    autopilot.observe(plane);
  }

  function frame(now) {
    const dt = previousFrame ? Math.min(0.125, (now - previousFrame) / 1000) : SIMULATION_STEP;
    previousFrame = now;
    clock.advance(dt, autolandActive, tick);
    aircraft.update(plane,time,dt,boost);
    shadow.position.set(plane.position.x,0.085,plane.position.z);
    shadow.rotation.z = plane.heading;
    shadow.material.opacity = Math.max(0,0.58 - Math.max(0,plane.position.y - GEAR_HEIGHT)/100);
    shadow.scale.setScalar(1 + (plane.position.y - GEAR_HEIGHT) / 110);
    updateCamera(dt);
    world.update(plane,camera,autopilot);
    hudAge += dt;
    if (hudAge > 0.092) {
      hudAge = 0;
      hud.update(plane, autopilot, atc.nearest(plane.position), traffic.aircraft, traffic.conflict, cameraModes[cameraMode], clock.speed);
    }
    renderer.render(scene,camera);
  }
  renderer.setAnimationLoop(frame);
  loading.hidden = true;
}

function makeShadow(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const shape = context.createRadialGradient(32,32,4,32,32,31);
  shape.addColorStop(0,'rgba(14,16,21,0.95)');
  shape.addColorStop(1,'rgba(14,16,21,0)');
  context.fillStyle = shape;
  context.fillRect(0,0,64,64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(22,24), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas), transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2,
  }));
  shadow.rotation.x = -degToRad(90);
  scene.add(shadow);
  return shadow;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch {
  loading.textContent = 'The flight view requires WebGL 2. Enable browser graphics acceleration to start.';
}
if (renderer) start(renderer);
