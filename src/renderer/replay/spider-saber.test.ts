import { readFileSync } from 'node:fs';

import { Box3, Color, Mesh, OneFactor, SrcAlphaFactor, Texture, TextureLoader, Vector2, ZeroFactor } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import type { Rgb } from '../../core/colors';
import type { FogUniforms } from '../bloomfog/pipeline';
import { shaderColorUniform } from '../materials/shared';
import { createCustomSaberInstance, customSaberTrailPoints, loadCustomSaberTrailTexture } from './custom-saber';
import { createSpiderSaberTrailMaterial } from './spider-saber-materials';

afterEach(() => vi.restoreAllMocks());

test('loads both native Spider meshes with isolated colors, Fresnel surfaces and aligned trails', async () => {
  const bytes = readFileSync(new URL('../../../public/sabers/models/spider-slider-sticks.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(gltf);
  const textures = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture());
  const fog: FogUniforms = {
    _BloomPrePassTexture: { value: new Texture() },
    _CustomFogTextureToScreenRatio: { value: new Vector2(1, 1) },
    _CustomFogOffset: { value: 0 },
    _CustomFogAttenuation: { value: 0 },
    _CustomFogHeightFogStartY: { value: 0 },
    _CustomFogHeightFogHeight: { value: 0 },
  };
  const colors: [Rgb, Rgb] = [
    [0.1, 0.9, 0.2],
    [0.9, 0.1, 0.8],
  ];
  const lights = { directions: [], colors: [], positions: [], radii: [] };
  const [left, right, otherPlayer, texture] = await Promise.all([
    createCustomSaberInstance('spider-slider-sticks', 0, colors, fog, lights),
    createCustomSaberInstance('spider-slider-sticks', 1, colors, fog, lights),
    createCustomSaberInstance(
      'spider-slider-sticks',
      0,
      [
        [1, 0, 0],
        [0, 0, 1],
      ],
      fog,
      lights,
    ),
    loadCustomSaberTrailTexture('spider-slider-sticks'),
  ]);
  expect(loader).toHaveBeenCalledOnce();
  expect(loader).toHaveBeenCalledWith(expect.stringContaining('sabers/models/spider-slider-sticks.glb'));
  expect(textures).toHaveBeenCalledWith(expect.stringContaining('sabers/textures/spider-slider-sticks-trail.png'));
  for (const [side, instance] of [left, right].entries()) {
    expect(instance.root.children).toHaveLength(5);
    expect(instance.colorBindings).toHaveLength(1);
    const glow = instance.colorBindings[0];
    expect(glow?.colorIndex).toBe(side);
    expect(glow?.material.uniforms._Glow?.value).toBe(0.75);
    if (glow === undefined) throw new Error('Missing Spider glow');
    expect(shaderColorUniform(glow.material, '_Color')).toEqual(
      new Color().setRGB(...colors[side as 0 | 1]).convertSRGBToLinear(),
    );
    const fresnel = instance.materials.find((material) => material.name === 'Fresnel::surface');
    expect(fresnel?.uniforms._Scale?.value).toBe(5);
    expect(fresnel?.uniforms._Power?.value).toBeCloseTo(1.29);
    expect(fresnel?.uniforms._Smoothness?.value).toBeCloseTo(0.175);
    expect(fresnel?.uniforms._BloomPrePassTexture?.value).toBe(fog._BloomPrePassTexture.value);
    expect(fresnel?.transparent).toBe(false);
    expect(fresnel?.depthWrite).toBe(true);
    const bounds = new Box3().setFromObject(instance.root);
    expect(bounds.min.z).toBeCloseTo(-1.0005, 3);
    expect(bounds.max.z).toBeCloseTo(0.18186, 4);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(0.07);
    let triangles = 0;
    for (const child of instance.root.children)
      if (child instanceof Mesh) triangles += (child.geometry.index?.count ?? 0) / 3;
    expect(triangles).toBe(66440);
  }
  const first = left.colorBindings[0]?.material;
  const other = otherPlayer.colorBindings[0]?.material;
  expect(first).not.toBe(other);
  if (first === undefined || other === undefined) throw new Error('Missing player glow');
  shaderColorUniform(first, '_Color')?.setRGB(0, 1, 0);
  expect(shaderColorUniform(other, '_Color')).toEqual(new Color(1, 0, 0));
  expect(customSaberTrailPoints('spider-slider-sticks')).toEqual({ base: 0.695900022983551, tip: 1.000499963760376 });
  const trail = createSpiderSaberTrailMaterial(colors[0], texture);
  expect(trail.uniforms._TintAlpha?.value).toBeCloseTo(80 / 255);
  expect(trail.uniforms._TrailTexture?.value).toBe(texture);
  expect(trail.blendSrc).toBe(SrcAlphaFactor);
  expect(trail.blendDst).toBe(OneFactor);
  expect(trail.depthWrite).toBe(false);
  expect(trail.blendSrcAlpha).toBe(ZeroFactor);
  expect(trail.blendDstAlpha).toBe(OneFactor);
  for (const instance of [left, right, otherPlayer]) for (const material of instance.materials) material.dispose();
  trail.dispose();
});
