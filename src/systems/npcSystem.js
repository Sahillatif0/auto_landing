// Local-space adaptation of the upstream NPCSystem. See LICENSE.
import { AircraftVisual } from '../world/AircraftVisual.js';
import { angleDelta, runwayPoint } from '../physics/flightMath.js';

const CALLSIGNS = ['Metro 218', 'Coastal 604', 'Cargo 372'];

export class NPCSystem {
  constructor(scene, runways) {
    this.scene = scene;
    this.npcs = runways.map((runway, index) => this.createNPCMesh(runway, index));
    this.conflict = null;
    this.update(0);
  }

  createNPCMesh(runway, index) {
    const visual = new AircraftVisual(this.scene, { tint: [0x376dd6, 0xd18b43, 0x9e478d][index] });
    return { runway, index, name: CALLSIGNS[index], visual, mesh: visual.group,
      position: visual.group.position, heading: 0, pitch: 0, roll: 0.17, gearDown: false };
  }

  toggleConflict(runway) {
    if (this.conflict) {
      this.scene.remove(this.conflict.mesh);
      this.conflict = null;
      return false;
    }
    this.conflict = this.createNPCMesh(runway, 0);
    this.conflict.name = 'Demo traffic';
    this.updateConflict(0, 0);
    return true;
  }

  update(time) {
    for (const npc of this.npcs) {
      const { runway, index } = npc;
      const crossing = index === 2 ? Math.PI / 2 : Math.PI * 1.5;
      const angle = crossing + (time - [172, 224, 198][index]) * (2 * Math.PI / [274, 307, 291][index]);
      const lateral = [1510, 1540, -1510][index];
      const along = 400 + 1760 * Math.cos(angle);
      const cross = lateral + 1290 * Math.sin(angle);
      const altitude = 1000 - 775 * Math.exp(-((angleDelta(crossing, angle) / 0.32) ** 2));
      npc.position.copy(runwayPoint(runway, along, altitude, cross));
      const a = -1760 * Math.sin(angle);
      const c = 1290 * Math.cos(angle);
      npc.heading = Math.atan2(a * runway.headingVec.x + c * runway.right.x, a * runway.headingVec.z + c * runway.right.z);
      npc.visual.update(npc, time, 1 / 60);
    }
    if (this.conflict) {
      this.conflict.phase ??= time;
      this.updateConflict(time - this.conflict.phase, time);
    }
  }

  updateConflict(elapsed, time) {
    const npc = this.conflict;
    const phase = elapsed * 0.21;
    npc.position.copy(runwayPoint(npc.runway, -365 + 215 * Math.cos(phase), 87, 215 * Math.sin(phase)));
    npc.heading = npc.runway.heading - phase - Math.PI / 2;
    npc.visual.update(npc, time, 1 / 60);
  }

  get aircraft() {
    return this.conflict ? [...this.npcs, this.conflict] : this.npcs;
  }

  clearConflict() {
    if (this.conflict) this.toggleConflict(this.conflict.runway);
  }
}
