import * as THREE from 'three';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/instrument-sans/latin-600.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import './style.css';
import { GroundTakeoffPhysics } from './physics/GroundTakeoffPhysics.js';
import { SIMULATION_SPEEDS, SIMULATION_STEP, SimulationClock } from './physics/SimulationClock.js';
import { GEAR_HEIGHT, angleDelta, clamp, degToRad } from './physics/flightMath.js';
import { AutonomousLandingController } from './autopilot/AutonomousLandingController.js';
import { AutonomousTakeoffController } from './autopilot/AutonomousTakeoffController.js';
import { createRunways } from './world/runways.js';
import { CityAndAirports } from './world/CityAndAirports.js';
import { AirspaceATC } from './world/AirspaceATC.js';
import { AircraftVisual } from './world/AircraftVisual.js';
import { NPCSystem } from './systems/npcSystem.js';
import { CrashEffect } from './world/CrashEffect.js';
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
  const camera = new THREE.PerspectiveCamera(55, 1, 0.65, 43500);
  const runways = createRunways();
  const world = new CityAndAirports(scene, runways);
  const plane = new GroundTakeoffPhysics(runways);
  const autopilot = new AutonomousLandingController(runways);
  const takeoff = new AutonomousTakeoffController(runways);
  const clock = new SimulationClock();
  const traffic = new NPCSystem(scene, runways);
  const atc = new AirspaceATC(runways);
  const aircraft = new AircraftVisual(scene, { player: true });
  const crashEffect = new CrashEffect(scene);
  const crashFlash = document.querySelector('#crash-flash');
  const shadow = makeShadow(scene);
  const keys = new Set();
  const reticle = document.querySelector('.target-reticle');
  const cameraModes = ['Chase cam', 'Nose cam', 'Wide cam'];
  let cameraMode = 0;
  let cameraReset = true;
  let cameraHeading = plane.heading;
  let cameraPitch = plane.pitch;
  let time = 0;
  let visualTime = 0;
  let throttle = 0;
  let manualGear = true;
  let previousFrame = 0;
  let hudAge = 1;
  let boost = false;
  let shake = 0;
  let crashSeen = null;
  const desired = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const side = new THREE.Vector3();
  const projection = new THREE.Vector3();
  const previousPose = { position: new THREE.Vector3() };
  const renderPose = { position: new THREE.Vector3() };

  function snapshot() {
    previousPose.position.copy(plane.position);
    previousPose.heading = plane.heading;
    previousPose.pitch = plane.pitch;
    previousPose.roll = plane.roll;
    previousPose.throttle = plane.throttle;
  }
  snapshot();

  function reset(airborne) {
    autopilot.reset();
    takeoff.reset();
    traffic.clearConflict();
    for (const runway of runways) runway.manualAtcOverride = null;
    time = 0;
    clock.reset();
    traffic.update(time);
    if (airborne) plane.positionForApproach(runways[0]);
    else plane.spawn(runways[0]);
    snapshot();
    throttle = plane.throttle;
    manualGear = true;
    cameraReset = true;
    shake = 0;
    crashSeen = null;
    crashEffect.clear();
    keys.clear();
  }

  function action(name, value) {
    const runway = takeoff.runway ?? autopilot.runway ?? atc.nearest(plane.position);
    switch (name) {
      case 'autoland':
        if (takeoff.active) break;
        takeoff.reset();
        autopilot.toggle(plane);
        throttle = plane.throttle;
        manualGear = plane.gearDown;
        break;
      case 'takeoff':
        if (autopilot.active) break;
        takeoff.toggle(plane);
        if (takeoff.active) autopilot.reset();
        throttle = plane.throttle;
        manualGear = plane.gearDown;
        break;
      case 'traffic': traffic.toggleConflict(runway); break;
      case 'atc': atc.toggleHold(runway); break;
      case 'reset': reset(false); break;
      case 'airborne': reset(true); break;
      case 'gear': if (plane.state === 'AIRBORNE' && !autopilot.active && !takeoff.active) manualGear = !manualGear; break;
      case 'camera':
        cameraMode = (cameraMode + 1) % cameraModes.length;
        cameraReset = true;
        break;
      case 'telemetry': hud.toggle(); break;
      case 'simulation-speed': clock.setSpeed(value); break;
      case 'cycle-speed': {
        const next = (SIMULATION_SPEEDS.indexOf(clock.speed) + 1) % SIMULATION_SPEEDS.length;
        clock.setSpeed(SIMULATION_SPEEDS[next]);
        break;
      }
    }
    atc.update(traffic.aircraft);
    hudAge = 1;
  }

  const hud = new TelemetryHUD(runways, action);
  const actions = { KeyL: 'autoland', KeyU: 'takeoff', KeyT: 'traffic', KeyG: 'atc', KeyR: 'reset', KeyF: 'airborne',
    KeyV: 'gear', KeyC: 'camera', KeyH: 'telemetry', KeyM: 'cycle-speed' };
  const controlKeys = new Set(['KeyW','ArrowUp','KeyS','ArrowDown','KeyA','KeyD','KeyQ','KeyE','ArrowLeft','ArrowRight',
    'Space','KeyX','ShiftLeft','ShiftRight']);

  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === '?') {
      event.preventDefault();
      hud.toggleShortcuts();
      return;
    }
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

  function updateCamera(dt, pose) {
    const rate = Math.sqrt(clock.activeSpeed());
    const amount = cameraReset || cameraMode === 1 ? 1 : 1 - Math.exp(-dt * 6 * rate);
    cameraHeading += angleDelta(pose.heading, cameraHeading) * amount;
    cameraPitch = THREE.MathUtils.lerp(cameraPitch, pose.pitch, amount);
    heading.set(Math.sin(cameraHeading),0,Math.cos(cameraHeading));
    side.set(heading.z,0,-heading.x);
    desired.copy(pose.position);
    focus.copy(pose.position);
    if (cameraMode === 1) {
      desired.addScaledVector(heading,7.8).y += 1.15;
      focus.addScaledVector(heading,105).y += Math.sin(cameraPitch)*78 + 1;
    } else if (cameraMode === 2) {
      desired.addScaledVector(heading,-86).addScaledVector(side,44).y += 36;
      focus.addScaledVector(heading,34).y += 3;
    } else {
      const distance = Math.max(30, 25 / camera.aspect);
      const airborne = clamp((pose.position.y - GEAR_HEIGHT) / 10, 0, 1);
      desired.addScaledVector(heading, -distance).addScaledVector(side, 9 - 3 * airborne).y += 8.2 + 0.5 * airborne;
      focus.addScaledVector(heading, 30).addScaledVector(side, 5).y += THREE.MathUtils.lerp(2.7, Math.sin(cameraPitch) * 9, airborne);
    }
    desired.y = Math.max(desired.y, 2.65);
    camera.position.copy(desired);
    if (shake > 0) {
      const amount = shake * shake * 1.8;
      camera.position.x += (Math.random() - 0.5) * amount;
      camera.position.y += (Math.random() - 0.5) * amount;
      camera.position.z += (Math.random() - 0.5) * amount;
      shake = Math.max(0, shake - dt * 1.5);
    }
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    cameraReset = false;
    heading.set(Math.sin(pose.heading), 0, Math.cos(pose.heading));
    projection.copy(pose.position).addScaledVector(heading,180);
    projection.y += Math.max(1, Math.sin(pose.pitch) * 180);
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
    snapshot();
    time += step;
    traffic.update(time);
    atc.update(traffic.aircraft);
    const command = autopilot.command(plane, step) ?? takeoff.command(plane);
    if (command) {
      boost = false;
      throttle = plane.throttle;
      manualGear = command.gearDown;
    }
    plane.update(step, command ?? manualCommand(step));
    autopilot.observe(plane);
    takeoff.observe(plane);
  }

  function frame(now) {
    const dt = previousFrame ? Math.min(0.125, (now - previousFrame) / 1000) : SIMULATION_STEP;
    previousFrame = now;
    const blend = clock.advance(dt, tick);
    renderPose.position.lerpVectors(previousPose.position, plane.position, blend);
    renderPose.heading = previousPose.heading + angleDelta(plane.heading, previousPose.heading) * blend;
    renderPose.pitch = THREE.MathUtils.lerp(previousPose.pitch, plane.pitch, blend);
    renderPose.roll = THREE.MathUtils.lerp(previousPose.roll, plane.roll, blend);
    renderPose.throttle = THREE.MathUtils.lerp(previousPose.throttle, plane.throttle, blend);
    renderPose.gearDown = plane.gearDown;
    visualTime += dt;
    aircraft.update(renderPose, visualTime, dt, boost);
    if (plane.crash && plane.crash !== crashSeen) {
      crashSeen = plane.crash;
      crashEffect.trigger(plane.crash.position);
      shake = 1;
      crashFlash.classList.remove('active');
      void crashFlash.offsetWidth;
      crashFlash.classList.add('active');
    }
    crashEffect.update(dt);
    const { x, y, z } = renderPose.position;
    shadow.position.set(x,0.088,z);
    shadow.rotation.z = renderPose.heading;
    shadow.material.opacity = Math.max(0,0.58 - Math.max(0,y - GEAR_HEIGHT)/100);
    shadow.visible = shadow.material.opacity > 0;
    shadow.scale.setScalar(1 + (y - GEAR_HEIGHT) / 110);
    updateCamera(dt, renderPose);
    world.update(renderPose,camera,autopilot);
    hudAge += dt;
    if (hudAge > 0.092) {
      hudAge = 0;
      hud.update(plane, autopilot, takeoff, atc.nearest(plane.position), traffic.aircraft, traffic.conflict, cameraModes[cameraMode], clock.speed);
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
  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
} catch {
  loading.textContent = 'The flight view requires WebGL 2. Enable browser graphics acceleration to start.';
}
if (renderer) start(renderer);
