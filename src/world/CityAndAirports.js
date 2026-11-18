import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LandingState } from '../autopilot/AutonomousLandingController.js';
import { clamp, degToRad, GEAR_HEIGHT, glideHeight, runwayCoordinates, runwayPoint } from '../physics/flightMath.js';

const lit = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.86, ...options });
const light = color => new THREE.MeshBasicMaterial({ color, toneMapped: false });
const asphalt = lit(0x313943);
const apron = lit(0x515966);
const paint = lit(0xf3eae2);
const pathPaint = lit(0xffce7c);
const terminal = lit(0x708594);
const terminalGlass = lit(0x324c64, { metalness: 0.49, roughness: 0.23, emissive: 0x122230 });
const beaconColors = { GREEN: 0x00ff66, RED: 0xff2222 };
const boxGeometry = new THREE.BoxGeometry();
const lampGeometry = new THREE.SphereGeometry(1, 12, 8);
const markerGeometry = new THREE.PlaneGeometry();
function seededRandom(seed) {
  return () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
}

export const CITY_CENTER = { x: -70, z: 920 };

function box(parent, material, x, y, z, width, height, length) {
  const mesh = new THREE.Mesh(boxGeometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, length);
  parent.add(mesh);
  return mesh;
}

function batch(scene, geometry, material, items, colorize = false) {
  if (!items.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const pose = new THREE.Object3D();
  items.forEach(([x,y,z,w,h,l,color], index) => {
    pose.position.set(x,y,z);
    pose.scale.set(w,h,l);
    pose.updateMatrix();
    mesh.setMatrixAt(index, pose.matrix);
    if (colorize) mesh.setColorAt(index, new THREE.Color(color));
  });
  scene.add(mesh);
  return mesh;
}

function groundTexture() {
  const random = seededRandom(37291);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(256, 256);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = 163 + Math.floor(random() * 44);
    pixels.data.set([value, value, value, 255], i);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function runwayNumber(text, width, length, color = '#fff1e7') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.font = 'bold 106px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 83);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.scale.set(width, length, 1);
  mesh.rotation.set(-Math.PI / 2, 0, Math.PI);
  return mesh;
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32,32,0,32,32,32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.88)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(0.43, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(canvas);
}

function signal(group, glowMap, x, y, z, size, color, radius = 14) {
  const bulb = new THREE.Mesh(lampGeometry, light(color));
  bulb.position.set(x,y,z);
  bulb.scale.setScalar(size);
  group.add(bulb);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowMap, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  glow.position.copy(bulb.position);
  glow.scale.set(radius,radius,1);
  group.add(glow);
  return { setColor(value) { bulb.material.color.setHex(value); glow.material.color.setHex(value); } };
}

function buildSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(37000, 30, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `
      varying vec3 ray;
      void main(){ ray = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec3 ray;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(36.13,91.73)))*43758.54); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
      }
      void main(){
        vec3 d=normalize(ray);
        float altitude=max(0.0,d.y);
        vec3 sun=normalize(vec3(0.77,0.105,0.63));
        float toward=max(0.0,dot(d,sun));
        vec3 horizon=mix(vec3(0.33,0.30,0.40),vec3(0.82,0.48,0.33),pow(toward,5.0));
        vec3 sky=mix(horizon,vec3(0.060,0.113,0.216),smoothstep(-0.01,0.64,altitude));
        sky += vec3(0.32,0.14,0.05)*pow(toward,28.0)*(1.0-smoothstep(0.0,0.5,altitude));
        vec2 uv=d.xz/(max(d.y,0.035)+0.12)*4.0+vec2(11.0,-4.0);
        float n=noise(uv*vec2(0.47,1.2))*0.6+noise(uv*2.05)*0.24+noise(uv*4.3)*0.11+noise(uv*9.4)*0.05;
        float clouds=smoothstep(0.49,0.73,n)*smoothstep(0.022,0.10,altitude)*(1.0-smoothstep(0.36,0.7,altitude));
        sky=mix(sky,mix(vec3(0.27,0.26,0.36),vec3(0.87,0.51,0.39),pow(toward,8.0)),clouds*0.64);
        sky += vec3(1.0,0.59,0.28)*smoothstep(0.99978,0.99987,toward)*0.8;
        gl_FragColor=vec4(sky,1.0);
      }
    `,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);
  return sky;
}

function createCity(scene) {
  const random = seededRandom(53745);
  const roads = [], sidewalks = [], buildings = [], rooftops = [], windows = [], trees = [], models = [];
  const palette = [0x687988, 0x849098, 0x52687b, 0x768194, 0x4b6275, 0x9a8990, 0x657887];
  for (let row = 0; row < 13; row++) {
    const z = -406 + row * 198;
    for (let col = 0; col < 15; col++) {
      const x = -1430 + col * 190 + (row % 2) * 18;
      if (z > -40 && z < 300 && x > 20) continue;
      if (z > 1130 && x < -1300) continue;
      if (x > 940 && z > 1520) continue;
      sidewalks.push([x,-0.008,z,169,0.025,173]);
      roads.push([x,0.007,z+94,196,0.025,15], [x+91,0.01,z,16,0.025,195]);
      if ((row + col * 3) % 11 === 5) {
        for (let j = 0; j < 9; j++) trees.push([x + random()*135-68,3,z+random()*140-70,5+random()*4,8+random()*5,5+random()*4,0x354b47]);
        continue;
      }
      for (let slot = 0; slot < 3; slot++) {
        const bx = x - 47 + (slot % 2) * 81 + (random() - 0.5) * 18;
        const bz = z - 44 + Math.floor(slot / 2) * 77 + (random() - 0.5) * 26;
        const core = Math.exp(-((bx - CITY_CENTER.x) ** 2 + (bz - CITY_CENTER.z) ** 2) / 900000);
        const height = 11 + random() ** 1.75 * (24 + core * 149);
        const width = 23 + random() * 32, depth = 26 + random() * 37;
        if ((col + row + slot) % 9 === 0) {
          const placement = new THREE.Group();
          placement.position.set(bx, 0, bz);
          scene.add(placement);
          const fallback = box(placement, lit(palette[(row + slot) % palette.length]), 0,height/2,0,width,height,depth);
          models.push({ placement, fallback, width, depth, height, index: (col + slot * 2) % 3 });
          continue;
        }
        buildings.push([bx,height/2,bz,width,height,depth,palette[(row + col + slot) % palette.length]]);
        if (height > 38) rooftops.push([bx,height+2,bz,width*0.38,4,depth*0.34,0x637284]);
        for (let floor = 6; floor < height - 3; floor += 4.8) {
          for (let pane = -1; pane < 2; pane++) {
            if (random() > 0.67) windows.push([bx + pane*width*0.28,floor,bz-depth/2-0.05,width*0.2,1.15,0.12,random()>0.45?0xffbc73:0x82acc0]);
            if (random() > 0.69) windows.push([bx-width/2-0.06,floor,bz+pane*depth*0.29,0.13,1.15,depth*0.21,0xb38d78]);
            if (random() > 0.78) windows.push([bx + pane*width*0.28,floor,bz+depth/2+0.06,width*0.2,1.15,0.13,0x9dbccc]);
          }
        }
      }
    }
  }
  batch(scene, boxGeometry, lit(0x464956), roads);
  batch(scene, boxGeometry, lit(0x666b62), sidewalks);
  batch(scene, boxGeometry, lit(0xffffff), buildings, true);
  batch(scene, boxGeometry, lit(0xffffff), rooftops, true);
  batch(scene, boxGeometry, new THREE.MeshBasicMaterial({ color: 0xdbc8c0 }), windows, true);
  batch(scene, new THREE.IcosahedronGeometry(0.7, 1), lit(0xffffff), trees, true);

  const loader = new GLTFLoader();
  const categories = ['building-a', 'building-b', 'building-c'];
  return Promise.allSettled(categories.map(async (name, index) => {
    const { scene: template } = await loader.loadAsync(import.meta.env.BASE_URL + 'models/kenney/' + name + '.glb');
    const bounds = new THREE.Box3().setFromObject(template);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const placements = models.filter(item => item.index === index);
    const transforms = placements.map(({ placement, width, depth, height }) => {
      const x = width / size.x, y = height / size.y, z = depth / size.z;
      return new THREE.Matrix4().makeScale(x, y, z).setPosition(
        placement.position.x - center.x * x, -bounds.min.y * y, placement.position.z - center.z * z);
    });
    template.traverse(node => {
      if (!node.isMesh) return;
      const batch = new THREE.InstancedMesh(node.geometry, node.material, transforms.length);
      const pose = new THREE.Matrix4();
      transforms.forEach((transform, i) => batch.setMatrixAt(i, pose.multiplyMatrices(transform, node.matrixWorld)));
      scene.add(batch);
    });
    for (const { placement, fallback } of placements) {
      fallback.material.dispose();
      scene.remove(placement);
    }
  }));
}

export class CityAndAirports {
  constructor(scene, runways) {
    this.scene = scene;
    this.sky = buildSky(scene);
    const diffuse = groundTexture();
    const runwayMap = diffuse.clone();
    runwayMap.needsUpdate = true;
    runwayMap.repeat.set(3, 95);
    asphalt.map = runwayMap;
    diffuse.repeat.set(420,420);
    const land = new THREE.Mesh(new THREE.PlaneGeometry(36000, 36000), lit(0x737a65, { map: diffuse }));
    land.rotation.x = -Math.PI / 2;
    land.position.y = -0.04;
    scene.add(land);
    box(scene, lit(0x526d88, { metalness: 0.54, roughness: 0.36 }), 2200,-0.027,4170,6400,0.025,4400);
    box(scene, lit(0x8a8272), 2055,-0.016,2030,6090,0.025,70);
    this.glowMap = makeGlowTexture();
    this.runwayVisuals = runways.map((runway, index) => this.buildRunway(runway, index));
    this.assetsReady = createCity(scene);
    this.path = new THREE.Group();
    scene.add(this.path);
    this.pathRunway = null;
  }

  buildRunway(runway, index) {
    const group = new THREE.Group();
    group.position.copy(runway.thresholdPos);
    group.rotation.y = runway.heading;
    this.scene.add(group);
    const { length, width } = runway;
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(width,length), asphalt);
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(0,0.012,length/2);
    group.add(surface);
    const marks = [];
    const edgeLamps = [];
    for (const side of [-1,1]) {
      marks.push([side*(width/2-2.4),0.045,length/2,0.55,0.024,length-11]);
      for (let i=0;i<6;i++) marks.push([side*(3.4+i*3.35),0.05,23,1.75,0.026,27]);
      marks.push([side*12,0.052,runway.aimPoint,4.4,0.026,35]);
      for (let i=0;i<3;i++) marks.push([side*(12+i*3),0.055,runway.aimPoint+148,0.95,0.026,12]);
      for (let depth=14;depth<length;depth+=42) edgeLamps.push([side*(width/2+0.65),0.16,depth,0.37,0.32,0.37]);
    }
    marks.push([0,0.048,8,width - 5,0.026,1.8]);
    for (let depth=100;depth<length-95;depth+=43) marks.push([0,0.045,depth,0.74,0.025,25]);
    batch(group,boxGeometry,paint,marks);
    batch(group,lampGeometry,light(0xffe7c6),edgeLamps);
    const number = runwayNumber(runway.id.slice(4), width*0.48, 30);
    number.position.set(0,0.072,62);
    group.add(number);
    const statuses = [-0.46,-0.33,-0.2,0.2,0.33,0.46].map(factor =>
      signal(group,this.glowMap,width*factor,0.37,4,0.53,beaconColors.GREEN,12));
    const approachLamps = [];
    for (let distance=100;distance<=720;distance+=55) {
      const bar = distance % 165 === 100;
      for (const dx of bar ? [-12,0,12] : [0]) {
        approachLamps.push([dx,0.6,-distance,0.59,0.59,0.59]);
      }
    }
    batch(group,lampGeometry,light(0xffd39b),approachLamps);
    const papi = [];
    for (let i=0;i<4;i++) {
      const x = -width/2-8-i*3.5;
      box(group,terminal,x,0.6,runway.aimPoint,1.25,1.15,1.3);
      papi.push(signal(group,this.glowMap,x,1.22,runway.aimPoint-0.7,0.54,0xffffff,7));
    }
    const side = index === 1 ? -1 : 1;
    const apronX = side * (width / 2 + 100);
    box(group,apron,apronX,0.015,252,147,0.045,600);
    box(group,apron,side*65,0.019,142,94,0.045,30);
    box(group,pathPaint,apronX,0.061,147,0.34,0.024,290);
    box(group,pathPaint,side*74,0.063,142,85,0.024,0.36);
    const buildings = [100,226,376];
    for (const z of buildings) {
      box(group,terminal,apronX+side*30,6,z,44,12,54);
      box(group,terminalGlass,apronX+side*7.9,4,z,0.25,5,40);
      box(group,terminalGlass,apronX+side*30,12.1,z,46,0.65,57);
      for (const dx of [11,24,37]) box(group,pathPaint,apronX-side*dx,0.072,z,0.32,0.024,33);
    }
    const towerX = apronX + side * 39;
    box(group,terminal,towerX,17,486,13,34,13);
    box(group,terminalGlass,towerX,36.5,486,20,7,20);
    box(group,terminal,towerX,40.8,486,22,1.65,22);
    box(group,terminal,towerX,44,486,0.9,6,0.9);
    statuses.push(signal(group,this.glowMap,towerX,47.4,486,1.8,beaconColors.GREEN,29));
    const sign = box(group,terminalGlass,-width/2-11,1.52,32,14,2.9,0.65);
    const label = runwayNumber(runway.id.slice(4),11,5,'#ffe3a3');
    label.rotation.set(0,Math.PI,0);
    label.position.set(sign.position.x,2,31.61);
    group.add(label);
    return { runway, statuses, papi, clearance: null, whiteLights: null };
  }

  update(plane, camera, autopilot) {
    this.sky.position.copy(camera.position);
    for (const visual of this.runwayVisuals) {
      const { runway, statuses, papi } = visual;
      if (visual.clearance !== runway.clearanceLight) {
        visual.clearance = runway.clearanceLight;
        statuses.forEach(lamp => lamp.setColor(beaconColors[visual.clearance]));
      }
      const { along, agl } = runwayCoordinates(runway, plane.position);
      const angle = Math.atan2(Math.max(0,agl - GEAR_HEIGHT), Math.max(1,runway.aimPoint-along));
      const white = along >= runway.aimPoint ? 0 : clamp(Math.round(2+(angle-degToRad(3))/degToRad(0.26)),0,4);
      if (visual.whiteLights !== white) {
        visual.whiteLights = white;
        papi.forEach((lamp,i) => lamp.setColor(i < white ? 0xfff5ed : 0xff2222));
      }
    }
    const approaching = autopilot.state === LandingState.INTERCEPT || autopilot.state === LandingState.FINAL ||
      autopilot.state === LandingState.FLARE;
    this.updateGates(approaching ? autopilot.runway : null);
  }

  updateGates(runway) {
    if (this.pathRunway === runway) return;
    this.pathRunway = runway;
    for (const child of [...this.path.children]) {
      child.geometry.dispose();
      child.material.dispose();
      this.path.remove(child);
    }
    if (!runway) return;
    const gates = [];
    for (let along=-1500;along<=100;along+=110) {
      const altitude = glideHeight(runway, along);
      const corner = (x,y) => runwayPoint(runway, along, altitude+y, x);
      const half = 25 + Math.abs(along)*0.012;
      const tall = 9.25;
      for (const sx of [-1,1]) for (const sy of [-1,1]) {
        const edge = corner(sx*half,sy*tall);
        gates.push(corner(sx*(half-11),sy*tall),edge,edge,corner(sx*half,sy*(tall-5.4)));
      }
    }
    const guide = [-1500,-1300,-1100,-900,-700,-500,-300,-100,100,300].map(along =>
      runwayPoint(runway,along,glideHeight(runway,along)));
    this.path.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gates),
      new THREE.LineBasicMaterial({ color: 0x5dffe1, transparent: true, opacity: 0.83, fog: false })));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(guide),
      new THREE.LineDashedMaterial({ color: 0x64f5d5, dashSize: 15, gapSize: 11, transparent: true, opacity: 0.45 }));
    line.computeLineDistances();
    this.path.add(line);
  }
}

