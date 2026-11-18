import { Vector3 } from 'three';
import { angleDelta, clamp, damp, degToRad, GEAR_HEIGHT, runwayPoint, V_REF } from './flightMath.js';
import { surfaceRunway } from '../world/runways.js';

const ROTATION_SPEED = 68;

export class GroundTakeoffPhysics {
  constructor(runways) {
    this.runways = runways;
    this.position = new Vector3();
    this.spawn(runways[0]);
  }

  spawn(runway) {
    this.setPose(runwayPoint(runway, 38, GEAR_HEIGHT), runway.heading, 0, 'GROUNDED');
  }

  positionForApproach(runway) {
    this.setPose(runwayPoint(runway, -1850, 117, -56), runway.heading + 0.035, V_REF + 9, 'AIRBORNE');
  }

  setPose(position, heading, speed, state) {
    this.position.copy(position);
    this.heading = heading;
    this.speed = speed;
    this.state = state;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.verticalSpeed = 0;
    this.throttle = state === 'GROUNDED' ? 0 : 0.53;
    this.gearDown = true;
    this.rotating = false;
    this.takeoffClimb = false;
    this.touchdown = null;
    this.crash = null;
  }

  update(dt, command) {
    if (this.state === 'STOPPED') return;
    this.touchdown = null;
    this.throttle = damp(this.throttle, command.throttle, command.goAround ? 8 : 3.6, dt);
    this.gearDown = this.state === 'GROUNDED' || command.gearDown;
    if (this.state === 'GROUNDED') this.updateGround(dt, command);
    else this.updateAir(dt, command);
    this.heading = angleDelta(this.heading, 0);
  }

  updateGround(dt, command) {
    const brake = command.brake ?? 0;
    const rollingDrag = 0.35 + 0.000095 * this.speed * this.speed;
    this.speed = clamp(this.speed + (this.throttle * 8.8 - rollingDrag - brake * 6.4) * dt, 0, 102);
    if (brake > 0 && this.speed < 0.2) this.speed = 0;
    const steerLimit = clamp(0.68 - this.speed * 0.0079, 0.105, 0.68);
    const motion = clamp(this.speed / 5, 0, 1);
    const yaw = command.heading == null ? command.yaw * steerLimit :
      clamp(angleDelta(command.heading, this.heading) * 1.5, -steerLimit, steerLimit);
    this.yawRate = damp(this.yawRate, yaw * motion, 4.5, dt);
    this.heading += this.yawRate * dt;
    this.roll = 0;
    this.verticalSpeed = 0;
    this.position.y = GEAR_HEIGHT;
    const surface = surfaceRunway(this.runways, this.position);
    if (!command.headingLock && (surface ? this.speed >= ROTATION_SPEED : this.speed >= ROTATION_SPEED + 8) &&
        (command.pitch > 0.1 || (this.speed >= 76 && this.throttle > 0.8))) this.rotating = true;
    if (brake > 0.1 || this.speed < ROTATION_SPEED - 4) this.rotating = false;
    this.pitch = damp(this.pitch, this.rotating ? degToRad(11) : 0, 2.15, dt);
    this.move(dt);
    if (this.rotating && this.pitch >= degToRad(8)) {
      this.state = 'AIRBORNE';
      this.position.y += 0.08;
      this.verticalSpeed = 1.5;
      this.takeoffClimb = true;
    }
  }

  updateAir(dt, command) {
    const gearDrag = this.gearDown ? 0.32 : 0;
    const drag = 0.35 + gearDrag + 0.00052 * this.speed ** 2;
    this.speed = clamp(this.speed + (7.5 * this.throttle - drag + (command.boost ? 4.2 : 0) - this.verticalSpeed * 0.08) * dt, 24, 150);
    if (this.position.y > 25 || command.pitchAngle != null || command.pitch < 0) this.takeoffClimb = false;
    const verticalTarget = command.verticalSpeed ?? (Math.sin(this.pitch) * this.speed * 0.77 - Math.max(0, 55 - this.speed) * 0.42);
    const manualPitch = this.takeoffClimb && command.pitch === 0 ? degToRad(9) : command.pitch * degToRad(24);
    const targetPitch = command.pitchAngle ?? manualPitch;
    const bank = command.heading == null ? command.roll * degToRad(51) :
      clamp(angleDelta(command.heading, this.heading) * 1.8, -degToRad(34), degToRad(34));
    this.pitch = damp(this.pitch, targetPitch, command.goAround ? 5.5 : 2.5, dt);
    this.roll = damp(this.roll, command.wingsLevel ? 0 : bank, command.wingsLevel ? 7 : 3.5, dt);
    const yaw = command.heading == null ? (Math.tan(this.roll) * 10 / Math.max(44, this.speed) + command.yaw * 0.17) :
      clamp(angleDelta(command.heading, this.heading) * 1.6, -0.215, 0.215);
    this.yawRate = damp(this.yawRate, yaw, command.wingsLevel ? 6 : 4.5, dt);
    this.heading += this.yawRate * dt;
    this.verticalSpeed = damp(this.verticalSpeed, verticalTarget, command.goAround ? 12 : 4, dt);
    this.move(dt);
    const contactHeight = this.gearDown ? GEAR_HEIGHT : 0.82;
    if (this.position.y > contactHeight || this.verticalSpeed >= 0) return;

    const runway = surfaceRunway(this.runways, this.position);
    this.position.y = contactHeight;
    this.touchdown = { runway, sinkRate: Math.max(0, -this.verticalSpeed), position: this.position.clone() };
    this.state = this.gearDown && Math.abs(this.roll) < degToRad(15) && this.verticalSpeed > -7 &&
      (runway || this.speed < V_REF) ? 'GROUNDED' : 'STOPPED';
    if (this.state === 'STOPPED') {
      this.crash = { position: this.position.clone(), sinkRate: this.touchdown.sinkRate, speed: this.speed,
        roll: this.roll, gearDown: this.gearDown, onRunway: Boolean(runway) };
      this.speed = 0;
    }
    this.verticalSpeed = 0;
    this.roll = 0;
    this.rotating = false;
  }

  move(dt) {
    const distance = this.speed * dt;
    this.position.x += Math.sin(this.heading) * distance;
    this.position.z += Math.cos(this.heading) * distance;
    this.position.y += this.verticalSpeed * dt;
  }
}
