import { angleDelta, degToRad, GEAR_HEIGHT, runwayCoordinates } from '../physics/flightMath.js';
import { surfaceRunway } from '../world/runways.js';
import { runwayAlignment } from './approachRoute.js';

export class AutonomousTakeoffController {
  constructor(runways) {
    this.runways = runways;
    this.reset();
  }

  reset() {
    this.runway = null;
    this.phase = '';
    this.message = '';
  }

  get active() {
    return this.runway !== null;
  }

  toggle(plane) {
    if (this.active) {
      this.finish('Auto takeoff disengaged · manual control');
      return;
    }
    const runway = plane.state === 'GROUNDED' ? surfaceRunway(this.runways, plane.position) : null;
    const along = runway ? runwayCoordinates(runway, plane.position).along : 0;
    if (!runway || runway.length - along < 900 || Math.abs(angleDelta(runway.heading, plane.heading)) > degToRad(20)) {
      this.message = 'Auto takeoff requires an aligned aircraft near the departure end. Press R to reset.';
      return;
    }
    this.runway = runway;
    this.phase = 'Waiting for clearance';
  }

  command(plane) {
    if (!this.active) return null;
    const runway = this.runway;
    if (plane.state === 'AIRBORNE') {
      this.phase = 'Climb out';
      this.message = `${runway.id} · climbing to 120 m AGL`;
      return { throttle: 0.82, pitchAngle: degToRad(10), verticalSpeed: 10.5, heading: runway.heading,
        wingsLevel: true, gearDown: plane.position.y - GEAR_HEIGHT < 30 };
    }
    if (this.phase === 'Rejected takeoff' || surfaceRunway(this.runways, plane.position) !== runway) {
      this.phase = 'Rejected takeoff';
      this.message = 'Auto takeoff braking · aircraft left the runway';
      return { throttle: 0, brake: 1, pitch: 0, yaw: 0, gearDown: true };
    }
    const clear = runway.clearanceLight === 'GREEN' && runway.nearbyTrafficCount === 0;
    const { cross } = runwayCoordinates(runway, plane.position);
    this.phase = clear ? 'Ground roll' : 'Waiting for clearance';
    this.message = clear ? `${runway.id} · accelerating for takeoff` : `${runway.id} · holding for green ATC clearance`;
    return { throttle: clear ? 1 : 0, brake: clear ? 0 : 1, pitch: clear ? 1 : 0,
      heading: runwayAlignment(runway, cross, 40 + plane.speed, 0.18), gearDown: true };
  }

  observe(plane) {
    if (!this.active) return;
    if (plane.state === 'AIRBORNE' && plane.position.y - GEAR_HEIGHT >= 120) {
      this.finish('Auto takeoff complete · manual control');
    } else if (this.phase === 'Rejected takeoff' && plane.speed === 0) {
      this.finish('Auto takeoff stopped · aircraft left the runway');
    } else if (plane.state === 'STOPPED') {
      this.finish('Auto takeoff stopped · use Runway reset to fly again');
    }
  }

  finish(message) {
    this.reset();
    this.message = message;
  }
}
