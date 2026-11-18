import { angleDelta, clamp, degToRad, GEAR_HEIGHT, glideHeight, headingTo, runwayCoordinates, runwayPoint, V_REF } from '../physics/flightMath.js';
import { advanceRoute, alignedForFinal, planRoute, runwayAlignment } from './approachRoute.js';

export const LandingState = Object.freeze({
  MANUAL: 'MANUAL', SCANNING: 'SCANNING_AND_HOLDING', INTERCEPT: 'INTERCEPT_INITIAL_APPROACH',
  FINAL: 'GLIDESLOPE_FINAL_APPROACH', FLARE: 'FLARE_AND_TOUCHDOWN', ROLLOUT: 'ROLLOUT_AND_BRAKING',
  GO_AROUND: 'GO_AROUND', COMPLETE: 'COMPLETE',
});
const LANDING_STATES = [LandingState.INTERCEPT, LandingState.FINAL, LandingState.FLARE];
const available = runway => runway.clearanceLight === 'GREEN' && runway.nearbyTrafficCount === 0;

export class AutonomousLandingController {
  constructor(runways) {
    this.runways = runways;
    this.reset();
  }

  reset() {
    this.state = LandingState.MANUAL;
    this.runway = null;
    this.rejected = null;
    this.route = null;
    this.summary = null;
    this.message = '';
    this.goAroundCount = 0;
  }

  get active() {
    return this.state !== LandingState.MANUAL && this.state !== LandingState.COMPLETE;
  }

  toggle(plane) {
    if (this.active) {
      this.reset();
    } else if (plane.state === 'AIRBORNE') {
      this.reset();
      this.state = LandingState.SCANNING;
    } else {
      this.message = 'Take off or use Airborne start to engage autoland.';
    }
  }

  chooseRunway(plane) {
    const candidates = this.runways.filter(available);
    const alternatives = candidates.filter(runway => runway !== this.rejected);
    const score = runway => {
      const alignment = Math.abs(angleDelta(runway.heading, plane.heading));
      const lateArrival = Math.max(0, runwayCoordinates(runway, plane.position).along + 650);
      return plane.position.distanceTo(runway.thresholdPos) + alignment * 295 + Math.min(750, lateArrival * 0.26);
    };
    return (alternatives.length ? alternatives : candidates)
      .reduce((best, runway) => !best || score(runway) < score(best) ? runway : best, null);
  }

  acquire(plane, runway) {
    this.runway = runway;
    this.state = LandingState.INTERCEPT;
    const { along, cross, agl } = runwayCoordinates(runway, plane.position);
    const directCapture = along < -440 && along > -3100 && Math.abs(cross) < Math.max(90, -along * 0.18) &&
      agl < glideHeight(runway, along) + Math.max(32, (-along - 450) * 0.075) &&
      Math.abs(angleDelta(runway.heading, plane.heading)) < 0.56;
    this.route = null;
    if (!directCapture) {
      this.arrivalAlong = -Math.max(1850, Math.min(5200, (agl - GEAR_HEIGHT - 35) / Math.tan(degToRad(3)) - runway.aimPoint));
      const arrival = runwayPoint(runway, this.arrivalAlong, Math.max(250, glideHeight(runway, this.arrivalAlong)));
      this.route = planRoute(plane.position, plane.heading, arrival, runway.heading);
      this.routeIndex = 0;
    }
    this.interceptTime = 0;
    this.message = `${runway.id} cleared. Intercepting approach.`;
  }

  goAround(plane, reason) {
    this.rejected = this.runway;
    this.state = LandingState.GO_AROUND;
    this.goAroundHeading = this.runway?.heading ?? plane.heading;
    this.goAroundAltitude = Math.max(255, plane.position.y + 38);
    this.route = null;
    this.goAroundCount++;
    this.message = reason;
  }

  command(plane, dt) {
    if (!this.active) return null;
    if (LANDING_STATES.includes(this.state) && !available(this.runway)) {
      this.goAround(plane, this.runway.nearbyTrafficCount ? 'Wave-off · traffic in approach corridor' : 'Wave-off · ATC clearance withdrawn');
    }
    if (this.state === LandingState.GO_AROUND) {
      if (plane.position.y < this.goAroundAltitude) {
        return { throttle: 0.9, pitchAngle: degToRad(10), verticalSpeed: 13, heading: this.goAroundHeading,
          wingsLevel: true, gearDown: plane.position.y < 38, goAround: true };
      }
      this.state = LandingState.SCANNING;
      this.runway = null;
    }
    if (this.state === LandingState.SCANNING) {
      const runway = this.chooseRunway(plane);
      if (runway) this.acquire(plane, runway);
      else {
        this.message = 'Holding · waiting for a clear runway';
        const verticalSpeed = clamp((340 - plane.position.y) * 0.14, -9, 10);
        return { throttle: this.speedThrottle(plane, 78, verticalSpeed, false), heading: plane.heading + 0.47,
          pitchAngle: degToRad(3) + Math.atan2(verticalSpeed, plane.speed), verticalSpeed, gearDown: false };
      }
    }

    const runway = this.runway;
    const coordinates = runwayCoordinates(runway, plane.position);
    const { along, cross, agl } = coordinates;
    if (this.state === LandingState.INTERCEPT) {
      this.interceptTime += dt;
      if (this.route) {
        this.routeIndex = advanceRoute(this.route, this.routeIndex, plane.position);
        const point = this.route[Math.min(this.route.length - 1, this.routeIndex + 5)];
        if (this.routeIndex < this.route.length - 6) {
          const altitude = Math.max(250, glideHeight(runway, this.arrivalAlong));
          return this.approachCommand(plane, headingTo(plane.position, point), clamp((altitude - agl) * 0.11, -11, 14), 72, false);
        }
        this.route = null;
      }
      if (alignedForFinal(plane, runway, coordinates) && Math.abs(agl - glideHeight(runway, along)) < 14) {
        this.state = LandingState.FINAL;
        this.message = `${runway.id} · tracking 3° glideslope`;
      } else if (along > -420 || this.interceptTime > 190) {
        this.goAround(plane, 'Wave-off · final approach capture missed');
        return this.command(plane, 0);
      } else {
        const descent = -plane.speed * Math.tan(degToRad(3));
        const verticalSpeed = clamp(descent + (glideHeight(runway, along) - agl) * 0.3, -13.5, 10);
        return this.approachCommand(plane, runwayAlignment(runway, cross, 155, 0.52), verticalSpeed, V_REF, true);
      }
    }
    if (this.state === LandingState.FINAL) {
      if (Math.abs(cross) > 48 || (along > 185 && agl > 18)) {
        this.goAround(plane, 'Wave-off · unstable final approach');
        return this.command(plane, 0);
      }
      if (agl <= 15 && along >= 0) {
        this.state = LandingState.FLARE;
        this.message = `${runway.id} · flare and touchdown`;
      } else {
        const verticalSpeed = clamp(-plane.speed * Math.tan(degToRad(3)) + (glideHeight(runway, along) - agl) * 0.46, -7.5, 3);
        return this.approachCommand(plane, runwayAlignment(runway, cross, 108, 0.18), verticalSpeed, V_REF, true, true);
      }
    }
    if (this.state === LandingState.FLARE) {
      if (along > runway.length - 650 || Math.abs(cross) > runway.width / 2 - 2) {
        this.goAround(plane, 'Wave-off · touchdown zone missed');
        return this.command(plane, 0);
      }
      return { throttle: 0, pitchAngle: degToRad(4), verticalSpeed: -clamp(0.8 + (agl - GEAR_HEIGHT) * 0.2, 0.8, 2.25),
        heading: runwayAlignment(runway, cross, 93, 0.11), wingsLevel: true, gearDown: true };
    }
    if (this.state === LandingState.ROLLOUT) {
      return { throttle: 0, brake: clamp(0.46 + (this.touchdownSpeed - plane.speed) * 0.031, 0.46, 1), pitch: 0,
        heading: runwayAlignment(runway, cross, 42 + plane.speed, 0.24), headingLock: true, gearDown: true };
    }
    return null;
  }

  speedThrottle(plane, target, climb, gearDown) {
    const drag = 0.35 + (gearDown ? 0.32 : 0) + 0.00052 * plane.speed ** 2;
    return clamp((drag + climb * 0.08 + (target - plane.speed) * 0.56) / 7.5, 0.04, 1);
  }

  approachCommand(plane, heading, verticalSpeed, speed, gearDown, wingsLevel = false) {
    return { throttle: this.speedThrottle(plane, speed, verticalSpeed, gearDown), heading, verticalSpeed,
      pitchAngle: degToRad(2.7) + Math.atan2(verticalSpeed, Math.max(45, plane.speed)), gearDown, wingsLevel };
  }

  observe(plane) {
    if (!this.active) return;
    if (plane.touchdown && LANDING_STATES.includes(this.state) && plane.state === 'GROUNDED' && plane.touchdown.runway === this.runway) {
      const { along, cross } = runwayCoordinates(this.runway, plane.touchdown.position);
      this.touchdownSpeed = plane.speed;
      this.summary = { runway: this.runway.id, sinkRate: plane.touchdown.sinkRate, offset: Math.abs(cross),
        touchdownAlong: along, stoppingDistance: 0 };
      this.state = LandingState.ROLLOUT;
      this.message = `${this.runway.id} · braking on centerline`;
    } else if (this.state === LandingState.ROLLOUT && plane.speed === 0) {
      this.summary.stoppingDistance = runwayCoordinates(this.runway, plane.position).along - this.summary.touchdownAlong;
      this.state = LandingState.COMPLETE;
      this.message = 'Autonomous landing complete';
    } else if (plane.state !== 'AIRBORNE' && this.state !== LandingState.ROLLOUT) {
      this.state = LandingState.MANUAL;
      this.message = 'Autoland disengaged · landing incomplete';
    }
  }
}
