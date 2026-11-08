import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Object3D,
  TorusGeometry,
  Vector3,
  type Material,
  type ShaderMaterial,
} from 'three';

import {
  DEFAULT_REPLAY_SABER_SETTINGS,
  DEFAULT_REPLAY_TRAIL_SETTINGS,
  type ReplaySaberSettings,
  type ReplayTrailSettings,
} from '../../core/viewer-settings';

interface SaberMaterials {
  blade: Material;
  core: Material;
  metal: Material;
  grip: Material;
}

export interface ReplaySaberModel {
  root: Group;
  trailBase: Object3D;
  tip: Object3D;
  geometries: BufferGeometry[];
  blade: Mesh;
  core: Mesh;
  tipWidth: number;
  hilt: Group;
  guard: Mesh;
  grip: Mesh;
  collars: Mesh[];
  pommel: Mesh;
  rings: Mesh[];
}

interface TrailNode {
  time: number;
  base: Vector3;
  axis: Vector3;
}

export interface ReplaySaberTrail {
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  nodes: TrailNode[];
  head: TrailNode;
  settings: ReplayTrailSettings;
}

const BLADE_RADIUS = 0.009;
const CORE_RADIUS = 0.0036;
const CORE_INSET = 0.004;
const GRIP_START = 0.0032;
const GRIP_LENGTH = 0.1424;
const GRIP_RADIUS = 0.009;
const GUARD_SIZE = 0.033;
const GUARD_THICKNESS = 0.002;
const COLLAR_SIZE = 0.0106;
const COLLAR_THICKNESS = 0.002;
const COLLAR_SPACING = 0.1408;
const RING_SIZE = 0.0096;
const RING_THICKNESS = 0.005;
const POMMEL_LENGTH = 0.0144;
const POMMEL_RADIUS = 0.0098;
const HILT_LENGTH = GRIP_START + GRIP_LENGTH + POMMEL_LENGTH;
const HILT_WIDTH = 1.05;
const MAX_RINGS = 5;

function cylinder(radius: number, length: number, segments = 12) {
  const geometry = new CylinderGeometry(radius, radius, length, segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function taper(radius: number, length: number, tipWidth: number) {
  const geometry = new CylinderGeometry(radius * tipWidth, radius, length, 12);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function createReplaySaber(materials: SaberMaterials): ReplaySaberModel {
  const root = new Group();
  const hilt = new Group();
  const geometries: BufferGeometry[] = [];
  function add(parent: Object3D, geometry: BufferGeometry, material: Material, z: number) {
    const mesh = new Mesh(geometry, material);
    mesh.position.z = z;
    parent.add(mesh);
    geometries.push(geometry);
    return mesh;
  }

  const blade = add(root, taper(BLADE_RADIUS, 1, 0), materials.blade, 0);
  const core = add(root, taper(CORE_RADIUS, 1 - CORE_INSET, 0), materials.core, 0);
  const guard = add(hilt, new TorusGeometry(GUARD_SIZE, GUARD_THICKNESS, 6, 32), materials.blade, GUARD_THICKNESS);
  const grip = add(hilt, cylinder(GRIP_RADIUS, GRIP_LENGTH, 16), materials.grip, GRIP_START + GRIP_LENGTH / 2);
  const collars: Mesh[] = [];
  for (const side of [-0.5, 0.5]) {
    collars.push(
      add(
        hilt,
        new TorusGeometry(COLLAR_SIZE, COLLAR_THICKNESS, 6, 24),
        materials.blade,
        HILT_LENGTH / 2 + 0.008 + side * COLLAR_SPACING,
      ),
    );
  }
  const rings = Array.from({ length: MAX_RINGS }, () =>
    add(hilt, cylinder(RING_SIZE, RING_THICKNESS, 16), materials.metal, 0),
  );
  const pommel = add(
    hilt,
    cylinder(POMMEL_RADIUS, POMMEL_LENGTH),
    materials.metal,
    GRIP_START + GRIP_LENGTH + POMMEL_LENGTH / 2,
  );

  const trailBase = new Object3D();
  const tip = new Object3D();
  root.add(hilt, trailBase, tip);
  const saber = {
    root,
    trailBase,
    tip,
    geometries,
    blade,
    core,
    tipWidth: 0,
    hilt,
    guard,
    grip,
    collars,
    pommel,
    rings,
  };
  setReplaySaberSettings(saber, DEFAULT_REPLAY_SABER_SETTINGS);
  return saber;
}

function replaceGeometry(saber: ReplaySaberModel, mesh: Mesh, geometry: BufferGeometry) {
  mesh.geometry.dispose();
  saber.geometries[saber.geometries.indexOf(mesh.geometry)] = geometry;
  mesh.geometry = geometry;
}

export function setReplaySaberSettings(saber: ReplaySaberModel, settings: ReplaySaberSettings) {
  const length = settings.saberBladeLength;
  if (settings.saberTipWidth !== saber.tipWidth) {
    saber.tipWidth = settings.saberTipWidth;
    replaceGeometry(saber, saber.blade, taper(BLADE_RADIUS, 1, saber.tipWidth));
    replaceGeometry(saber, saber.core, taper(CORE_RADIUS, 1 - CORE_INSET, saber.tipWidth));
  }
  saber.root.visible = settings.showSabers;
  saber.root.scale.set(
    settings.saberScale * settings.saberWidth,
    settings.saberScale * settings.saberWidth,
    settings.saberScale,
  );
  saber.blade.position.z = -length / 2;
  const bladeWidth =
    (settings.saberBladeWidth * settings.saberBladeThickness) / DEFAULT_REPLAY_SABER_SETTINGS.saberBladeThickness;
  const coreWidth =
    (settings.saberBladeWidth * settings.saberCoreThickness) / DEFAULT_REPLAY_SABER_SETTINGS.saberCoreThickness;
  saber.blade.scale.set(bladeWidth, bladeWidth, length);
  saber.core.position.z = -length / 2;
  saber.core.scale.set(coreWidth, coreWidth, Math.max(length - settings.saberCoreInset, 0.01) / (1 - CORE_INSET));
  const hiltWidth = settings.saberHiltWidth * HILT_WIDTH;
  saber.hilt.scale.set(hiltWidth, hiltWidth, settings.saberHiltLength / HILT_LENGTH);
  const defaults = DEFAULT_REPLAY_SABER_SETTINGS;
  const hiltLength = GRIP_START + settings.saberGripLength + settings.saberPommelLength;
  saber.guard.position.z = settings.saberGuardThickness;
  saber.guard.scale.set(
    settings.saberGuardSize / defaults.saberGuardSize,
    settings.saberGuardSize / defaults.saberGuardSize,
    settings.saberGuardThickness / defaults.saberGuardThickness,
  );
  saber.grip.position.z = GRIP_START + settings.saberGripLength / 2;
  saber.grip.scale.set(
    settings.saberGripThickness / defaults.saberGripThickness,
    settings.saberGripThickness / defaults.saberGripThickness,
    settings.saberGripLength / defaults.saberGripLength,
  );
  saber.collars.forEach((collar, index) => {
    collar.position.z = hiltLength / 2 + 0.008 + (index === 0 ? -0.5 : 0.5) * settings.saberCollarSpacing;
    collar.scale.set(
      settings.saberCollarSize / defaults.saberCollarSize,
      settings.saberCollarSize / defaults.saberCollarSize,
      settings.saberCollarThickness / defaults.saberCollarThickness,
    );
  });
  saber.pommel.position.z = GRIP_START + settings.saberGripLength + settings.saberPommelLength / 2;
  saber.pommel.scale.set(
    settings.saberPommelThickness / defaults.saberPommelThickness,
    settings.saberPommelThickness / defaults.saberPommelThickness,
    settings.saberPommelLength / defaults.saberPommelLength,
  );
  saber.rings.forEach((ring, index) => {
    ring.visible = index < settings.saberRingCount;
    ring.position.z = hiltLength * 0.53 + (index - (settings.saberRingCount - 1) / 2) * settings.saberRingSpacing;
    ring.scale.set(
      settings.saberRingSize / defaults.saberRingSize,
      settings.saberRingSize / defaults.saberRingSize,
      settings.saberRingThickness / defaults.saberRingThickness,
    );
  });
  saber.tip.position.z = -length;
  saber.trailBase.position.z = -length * (1 - settings.saberTrailWidth);
}

function configureTrailGeometry(trail: ReplaySaberTrail) {
  // Retain the fork's sample budget while sampling the upstream trail in song time.
  const rows = Math.max(2, trail.settings.replayTrailSamples * (trail.settings.replayTrailSmoothing ? 5 : 1));
  const geometry = trail.mesh.geometry;
  const trailUv = new Float32Array(rows * 4);
  const alpha = new Float32Array(rows * 2);
  const uv = new Float32Array(rows * 4);
  const indices = new Uint16Array((rows - 1) * 6);
  for (let row = 0; row < rows; row++) {
    const age = row / (rows - 1);
    uv.set([0, age, 1, age], row * 4);
    // Custom textures run from the live edge (u=0) to the oldest edge (u=1).
    trailUv.set([age, 1, age, 0], row * 4);
    const opacity =
      (1 - age) ** trail.settings.replayTrailFade *
      trail.settings.replayTrailOpacity *
      trail.settings.saberTrailBrightness;
    alpha.fill(opacity, row * 2, row * 2 + 2);
    if (row === rows - 1) continue;
    const vertex = row * 2;
    indices.set([vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3], row * 6);
  }
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(rows * 6), 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('trailUv', new BufferAttribute(trailUv, 2));
  geometry.setAttribute('trailAlpha', new BufferAttribute(alpha, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
}

export function createReplaySaberTrail(
  material: ShaderMaterial,
  settings = DEFAULT_REPLAY_TRAIL_SETTINGS,
): ReplaySaberTrail {
  const geometry = new BufferGeometry();
  geometry.setDrawRange(0, 0);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const trail = {
    mesh,
    nodes: [],
    head: { time: 0, base: new Vector3(), axis: new Vector3() },
    settings: { ...settings },
  };
  setReplaySaberTrailSettings(trail, settings);
  return trail;
}

export function setReplaySaberTrailSettings(trail: ReplaySaberTrail, settings: ReplayTrailSettings) {
  trail.settings = { ...settings };
  trail.mesh.visible = settings.showSaberTrails;
  const { _Brightness, _Duration } = trail.mesh.material.uniforms;
  if (_Brightness !== undefined) _Brightness.value = settings.saberTrailBrightness * settings.replayTrailOpacity;
  const fade = trail.mesh.material.uniforms._TrailFade;
  if (fade !== undefined) fade.value = settings.replayTrailFade;
  if (_Duration !== undefined) _Duration.value = settings.saberTrailDuration;
  configureTrailGeometry(trail);
}

export function setReplaySaberTrailMaterial(trail: ReplaySaberTrail, material: ShaderMaterial) {
  trail.mesh.material = material;
  setReplaySaberTrailSettings(trail, trail.settings);
}

export function clearReplaySaberTrail(trail: ReplaySaberTrail) {
  trail.nodes.length = 0;
  trail.mesh.geometry.setDrawRange(0, 0);
}

export function addReplaySaberTrailNode(trail: ReplaySaberTrail, time: number, base: Vector3, tip: Vector3) {
  const last = trail.nodes.at(-1);
  if (last !== undefined && time <= last.time) return;
  const threshold = trail.settings.replayTrailMotionThreshold;
  if (
    last !== undefined &&
    last.base.distanceToSquared(base) < threshold * threshold &&
    last.base.clone().add(last.axis).distanceToSquared(tip) < threshold * threshold
  )
    return;
  trail.nodes.push({ time, base: base.clone(), axis: tip.clone().sub(base) });
}

const fromTangent = new Vector3();
const toTangent = new Vector3();
const basePoint = new Vector3();
const axis = new Vector3();

function hermite(
  target: Vector3,
  key: 'base' | 'axis',
  previous: TrailNode,
  from: TrailNode,
  to: TrailNode,
  next: TrailNode,
  amount: number,
) {
  const span = to.time - from.time;
  fromTangent.subVectors(to[key], previous[key]).multiplyScalar(span / (to.time - previous.time));
  toTangent.subVectors(next[key], from[key]).multiplyScalar(span / (next.time - from.time));
  const squared = amount * amount;
  const cubed = squared * amount;
  return target
    .copy(from[key])
    .multiplyScalar(2 * cubed - 3 * squared + 1)
    .addScaledVector(fromTangent, cubed - 2 * squared + amount)
    .addScaledVector(to[key], 3 * squared - 2 * cubed)
    .addScaledVector(toTangent, cubed - squared);
}

export function updateReplaySaberTrail(trail: ReplaySaberTrail, time: number, base: Vector3, tip: Vector3) {
  const cutoff = time - trail.settings.saberTrailDuration;
  const { nodes, head } = trail;
  while ((nodes[1]?.time ?? Number.POSITIVE_INFINITY) <= cutoff) nodes.shift();
  head.time = time;
  head.base.copy(base);
  head.axis.subVectors(tip, base);
  const points = nodes.at(-1)?.time === time ? [...nodes] : [...nodes, head];
  const first = points[0];
  if (first === undefined || first === head) {
    trail.mesh.geometry.setDrawRange(0, 0);
    return;
  }

  const position = trail.mesh.geometry.getAttribute('position');
  const rows = position.count / 2;
  let segment = points.length - 2;
  for (let row = 0; row < rows; row++) {
    const sampleTime = Math.max(time - (trail.settings.saberTrailDuration * row) / (rows - 1), first.time);
    while (segment > 0 && (points[segment]?.time ?? 0) > sampleTime) segment--;
    const from = points[segment] ?? first;
    const to = points[segment + 1] ?? from;
    const span = to.time - from.time;
    const amount = span <= 0 ? 0 : Math.min(Math.max((sampleTime - from.time) / span, 0), 1);
    const previous = points[segment - 1] ?? from;
    const next = points[segment + 2] ?? to;
    if (trail.settings.replayTrailSmoothing && span > 0) hermite(axis, 'axis', previous, from, to, next, amount);
    else axis.lerpVectors(from.axis, to.axis, amount);
    axis.setLength(from.axis.length() + (to.axis.length() - from.axis.length()) * amount);
    if (trail.settings.replayTrailSmoothing && span > 0) hermite(basePoint, 'base', previous, from, to, next, amount);
    else basePoint.lerpVectors(from.base, to.base, amount);
    const age = row / (rows - 1);
    const styleCollapse = trail.settings.replayTrailStyle === 'flag' ? age * 0.5 : 0;
    const collapse = styleCollapse + (0.5 - styleCollapse) * trail.settings.replayTrailThinness;
    basePoint.addScaledVector(axis, collapse);
    axis.multiplyScalar(1 - 2 * collapse);
    position.setXYZ(row * 2, basePoint.x, basePoint.y, basePoint.z);
    position.setXYZ(row * 2 + 1, basePoint.x + axis.x, basePoint.y + axis.y, basePoint.z + axis.z);
  }
  position.needsUpdate = true;
  trail.mesh.geometry.setDrawRange(0, (rows - 1) * 6);
}
