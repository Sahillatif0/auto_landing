import * as THREE from 'three';
import { JetFlame } from '../plane/jetFlame.js';
import { damp } from '../physics/flightMath.js';

const metal = color => new THREE.MeshStandardMaterial({ color, metalness: 0.37, roughness: 0.36 });
const paint = metal(0xc9dce5);
const trim = metal(0x147d7e);
const dark = metal(0x202935);
const glass = new THREE.MeshPhysicalMaterial({ color: 0x171e35, metalness: 0.58, roughness: 0.13, clearcoat: 1 });
const tire = new THREE.MeshStandardMaterial({ color: 0x121822, roughness: 1 });
let airframe;
let wheelGeometry;

function ring(radii, stretches, material, group) {
  const geometry = new THREE.LatheGeometry(radii.map(([radius, length]) => new THREE.Vector2(radius, length)), 32);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.scale.set(stretches[0], 1, stretches[1]);
  group.add(mesh);
  return mesh;
}

function foil(points, material, thickness) {
  const vertices = points.flatMap(([x, y, z]) => [x, y + thickness, z])
    .concat(points.flatMap(([x, y, z]) => [x, y - thickness, z]));
  const count = points.length;
  const indices = [];
  for (let i = 1; i < count - 1; i++) indices.push(0, i + 1, i, count, count + i, count + i + 1);
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(i, next, count + next, i, count + next, count + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  material.side = THREE.DoubleSide;
  return mesh;
}

function sphere(group, material, position, scale) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  group.add(mesh);
  return mesh;
}

function buildAirframe() {
  const group = new THREE.Group();
  // Positive local Z is the nose. The model origin is at the main landing gear axle line.
  ring([[0.19,-8.1],[0.59,-7.5],[1.02,-5],[1.27,-2],[1.26,2.8],[1.18,4.4],[0.87,6.1],[0.49,7.2],[0.03,8.05]], [1,0.91], paint, group);
  const cockpit = sphere(group, glass, [0,0.8,5.25], [0.87,0.42,1.85]);
  cockpit.rotation.x = -0.06;
  for (const side of [-1, 1]) {
    group.add(foil([[0.55,-0.26,3.1],[side * 2.1,-0.34,2.8],[side * 10.2,0.38,-1.55],
      [side * 10.25,0.41,-2.6],[side * 4.1,-0.38,-3.1],[side * 0.55,-0.45,-4]], paint, 0.12));
    group.add(foil([[side * 9.75,0.44,-1.36],[side * 10.2,0.48,-1.55],[side * 10.25,0.48,-2.6],
      [side * 9.75,0.45,-2.63]], trim, 0.07));
    group.add(foil([[0.27,2.1,-6.75],[side * 3.95,2.27,-7.82],[side * 3.96,2.28,-8.43],
      [0.22,2.12,-8.15]], paint, 0.08));
    const engine = ring([[0.54,-1.71],[0.68,-1.48],[0.7,1.11],[0.65,1.63],[0.5,1.9]], [1,1], paint, group);
    engine.position.set(side * 1.63, -0.05, -4.82);
    const intake = ring([[0.52,1.61],[0.51,1.87],[0.39,1.92],[0.35,1.72],[0,1.7]], [1,1], dark, group);
    intake.position.copy(engine.position);
    sphere(group, new THREE.MeshBasicMaterial({ color: side < 0 ? 0x43ffbb : 0xff3156, toneMapped: false }),
      [side * 10.19,0.44,-1.92], [0.15,0.12,0.31]);
    for (let i = 0; i < 7; i++) sphere(group, glass, [side * 1.235,0.19,2.8 - i * 0.67], [0.035,0.12,0.17]);
  }
  const fin = foil([[0,0.41,-3.8],[0,2.2,-5.43],[0,3.68,-6.5],[0,3.73,-7.63],[0,0.23,-8.11]], trim, 0.095);
  // The vertical fin has thickness across the fuselage, not along its own height.
  const positions = fin.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const thickness = i < positions.count / 2 ? 0.095 : -0.095;
    positions.setX(i, thickness);
    positions.setY(i, positions.getY(i) - thickness);
  }
  fin.geometry.computeVertexNormals();
  group.add(fin);
  return group;
}

export class AircraftVisual {
  constructor(scene, { player = false, tint = null } = {}) {
    airframe ??= buildAirframe();
    this.group = airframe.clone();
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
    if (tint !== null) {
      const livery = metal(tint);
      this.group.traverse(mesh => { if (mesh.material === trim) mesh.material = livery; });
    }
    this.gear = new THREE.Group();
    this.group.add(this.gear);
    this.flames = [];
    if (player) {
      this.buildGear();
      for (const side of [-1, 1]) {
        const flame = new JetFlame();
        flame.group.position.set(side * 1.63, -0.05, -6.2);
        flame.group.rotation.y = Math.PI;
        flame.group.scale.setScalar(1.85);
        flame.group.remove(flame.light);
        this.group.add(flame.group);
        this.flames.push(flame);
      }
    }
  }

  buildGear() {
    wheelGeometry ??= new THREE.CylinderGeometry(0.45, 0.45, 0.33, 16);
    for (const [x, z] of [[-2.02,-1.45],[2.02,-1.45],[0,4.32]]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.13, 1.33, 10), paint);
      strut.position.set(x,-0.97,z);
      this.gear.add(strut);
      const wheel = new THREE.Mesh(wheelGeometry, tire);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x,-1.6,z);
      this.gear.add(wheel);
    }
  }

  update(plane, time, dt, boost = false) {
    this.group.position.copy(plane.position);
    this.group.rotation.set(-plane.pitch, plane.heading, -plane.roll, 'YXZ');
    this.gear.scale.y = damp(this.gear.scale.y, plane.gearDown ? 1 : 0.03, 5, dt);
    this.gear.visible = this.gear.scale.y > 0.065;
    for (const flame of this.flames) {
      flame.group.visible = plane.throttle > 0.1;
      flame.update(plane.throttle, boost, time, dt);
    }
  }
}
