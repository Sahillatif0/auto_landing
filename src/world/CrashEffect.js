import * as THREE from 'three';

const FIRE = { count: 110, size: 3.4, life: 1.05, speed: 26, rise: 17, gravity: -11, drag: 1.9, color: 0xffb347, opacity: 1 };
const SMOKE = { count: 70, size: 6, life: 3.6, speed: 11, rise: 10, gravity: 1.4, drag: 0.9, color: 0x3c3c44, opacity: 0.42 };
const DEBRIS = { count: 30, size: 0.9, life: 2.4, speed: 32, rise: 24, gravity: -26, drag: 0.35, color: 0x14161c, opacity: 1 };

function glowTexture(inner, mid) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.4, mid);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

class Burst {
  constructor(config, texture, blending) {
    this.config = config;
    this.age = config.life;
    this.positions = new Float32Array(config.count * 3);
    this.velocities = new Float32Array(config.count * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      size: config.size,
      map: texture,
      color: config.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  trigger(origin) {
    const { count, speed, rise } = this.config;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * speed;
      this.positions[i * 3] = origin.x + (Math.random() - 0.5) * 4;
      this.positions[i * 3 + 1] = origin.y + Math.random() * 2.4;
      this.positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 4;
      this.velocities[i * 3] = Math.cos(angle) * spread;
      this.velocities[i * 3 + 1] = rise * (0.35 + Math.random() * 0.9);
      this.velocities[i * 3 + 2] = Math.sin(angle) * spread;
    }
    this.age = 0;
    this.geometry.attributes.position.needsUpdate = true;
    this.points.visible = true;
  }

  update(dt) {
    if (this.age >= this.config.life) {
      this.points.visible = false;
      return;
    }
    const { gravity, drag, life, opacity } = this.config;
    this.age += dt;
    const damping = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.positions.length; i += 3) {
      this.velocities[i] *= damping;
      this.velocities[i + 1] = this.velocities[i + 1] * damping + gravity * dt;
      this.velocities[i + 2] *= damping;
      this.positions[i] += this.velocities[i] * dt;
      this.positions[i + 1] = Math.max(0.4, this.positions[i + 1] + this.velocities[i + 1] * dt);
      this.positions[i + 2] += this.velocities[i + 2] * dt;
    }
    this.geometry.attributes.position.needsUpdate = true;
    const progress = Math.min(1, this.age / life);
    this.material.opacity = opacity * (1 - progress) ** 1.4;
  }
}

export class CrashEffect {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const fireTexture = glowTexture('rgba(255, 255, 236, 1)', 'rgba(255, 138, 40, 0.85)');
    const smokeTexture = glowTexture('rgba(96, 96, 104, 0.9)', 'rgba(40, 40, 46, 0.55)');
    const debrisTexture = glowTexture('rgba(28, 30, 36, 1)', 'rgba(18, 20, 26, 0.9)');

    this.fire = new Burst(FIRE, fireTexture, THREE.AdditiveBlending);
    this.smoke = new Burst(SMOKE, smokeTexture, THREE.NormalBlending);
    this.debris = new Burst(DEBRIS, debrisTexture, THREE.NormalBlending);
    this.group.add(this.fire.points, this.smoke.points, this.debris.points);

    this.fireball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffa53a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1, 56),
      new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.light = new THREE.PointLight(0xff7a2a, 0, 320, 2);
    this.group.add(this.fireball, this.core, this.ring, this.light);

    this.age = Infinity;
    this.origin = new THREE.Vector3();
  }

  trigger(position) {
    this.origin.copy(position);
    this.age = 0;
    this.group.visible = true;
    this.fire.trigger(position);
    this.smoke.trigger(position);
    this.debris.trigger(position);
    this.fireball.position.set(position.x, position.y + 1.6, position.z);
    this.core.position.set(position.x, position.y + 1.6, position.z);
    this.ring.position.set(position.x, 0.35, position.z);
    this.light.position.set(position.x, position.y + 3, position.z);
  }

  clear() {
    this.age = Infinity;
    this.group.visible = false;
  }

  update(dt) {
    if (this.age === Infinity) return;
    this.age += dt;
    this.fire.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);

    const blast = Math.min(1, this.age / 0.55);
    const blastFade = 1 - blast;
    this.fireball.scale.setScalar(1.6 + blast * 7.5);
    this.fireball.material.opacity = blastFade * 0.5;
    this.core.scale.setScalar(0.8 + blast * 3.6);
    this.core.material.opacity = blastFade * 0.7;

    const wave = Math.min(1, this.age / 0.9);
    this.ring.scale.setScalar(3 + wave * 46);
    this.ring.material.opacity = (1 - wave) * 0.42;

    this.light.intensity = Math.max(0, 1 - this.age / 0.7) * 90;

    if (this.age > 4.2) {
      this.age = Infinity;
      this.group.visible = false;
    }
  }
}
