import { readFileSync } from 'node:fs';

import { Box3, Color, Mesh, NoColorSpace, RepeatWrapping, Texture, TextureLoader, Vector2 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import type { Rgb } from '../../core/colors';
import type { FogUniforms } from '../bloomfog/pipeline';
import { shaderColorUniform } from '../materials/shared';
import { createCustomSaberInstance, customSaberTrailPoints, loadCustomSaberTrailTexture } from './custom-saber';
import { createScSaberTrailMaterial } from './sc-saber-materials';

afterEach(() => vi.restoreAllMocks());

for (const model of ['sc-saber', 'sc-saber-cc'] as const) {
  test(`${model} loads native meshes at the grip with native materials and independent player colors`, async () => {
    const bytes = readFileSync(new URL(`../../../public/sabers/models/${model}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(gltf);
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture());
    const fog: FogUniforms = {
      _BloomPrePassTexture: { value: new Texture() },
      _CustomFogTextureToScreenRatio: { value: new Vector2(1, 1) },
      _CustomFogOffset: { value: 0 },
      _CustomFogAttenuation: { value: 0 },
      _CustomFogHeightFogStartY: { value: 0 },
      _CustomFogHeightFogHeight: { value: 0 },
    };
    const lights = { directions: [], colors: [], positions: [], radii: [] };
    const colors: [Rgb, Rgb] = [
      [0.1, 0.9, 0.2],
      [0.9, 0.1, 0.8],
    ];
    const otherColors: [Rgb, Rgb] = [
      [1, 0, 0],
      [0, 0, 1],
    ];
    const [left, right, other, texture] = await Promise.all([
      createCustomSaberInstance(model, 0, colors, fog, lights),
      createCustomSaberInstance(model, 1, colors, fog, lights),
      createCustomSaberInstance(model, 0, otherColors, fog, lights),
      loadCustomSaberTrailTexture(model),
    ]);
    expect(loader).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith(expect.stringContaining(`sabers/models/${model}.glb`));
    for (const [side, instance] of [left, right].entries()) {
      expect(instance.root.children).toHaveLength(6);
      let triangles = 0;
      for (const child of instance.root.children) {
        if (child instanceof Mesh) triangles += (child.geometry.index?.count ?? 0) / 3;
      }
      expect(triangles).toBe(73316);
      const bounds = new Box3().setFromObject(instance.root);
      expect(bounds.min.z).toBeCloseTo(-0.9989869);
      expect(bounds.max.z).toBeCloseTo(0.1730704);
      // The Unity preview places each saber 30 cm away from the origin.
      // Runtime geometry must be centered on the player's grip instead.
      expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(0);
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(0.072883);
      expect(instance.colorBindings).toHaveLength(model === 'sc-saber-cc' ? 3 : 0);
      for (const binding of instance.colorBindings) {
        expect(binding.colorIndex).toBe(side);
        expect(shaderColorUniform(binding.material, '_Color')).toEqual(
          new Color().setRGB(...colors[side as 0 | 1]).convertSRGBToLinear(),
        );
      }
      const handle = instance.materials.find((material) => material.name.startsWith('handle'));
      expect(handle?.transparent).toBe(false);
      expect(handle?.depthWrite).toBe(true);
      const blade = instance.materials.find((material) => material.name.startsWith('saber'));
      expect(blade?.uniforms._ColorPower?.value).toBe(15);
      expect(blade?.uniforms._FresnelPower?.value).toBe(2);
      const logo = instance.materials.find((material) => material.name.startsWith('SCLogo'));
      expect(logo?.defines.SC_HOLOGRAM).toBe(1);
      const mask: Texture = logo?.uniforms._HologramTexture?.value;
      expect(mask.name).toBe('sc-saber-hologram.png');
      expect(mask.colorSpace).toBe(NoColorSpace);
      expect(mask.wrapS).toBe(RepeatWrapping);
      expect(mask.wrapT).toBe(RepeatWrapping);
    }
    if (model === 'sc-saber-cc') {
      const own = left.colorBindings[0]?.material;
      const independent = other.colorBindings[0]?.material;
      expect(own).not.toBe(independent);
      if (own === undefined || independent === undefined) throw new Error('Missing custom color binding');
      shaderColorUniform(own, '_Color')?.setRGB(0, 1, 0);
      expect(shaderColorUniform(independent, '_Color')).toEqual(new Color(1, 0, 0));
    } else {
      const own = left.materials.find((material) => material.name === 'saber::static-glow');
      const independent = other.materials.find((material) => material.name === 'saber::static-glow');
      if (own === undefined || independent === undefined) throw new Error('Missing fixed-color blade');
      const color = shaderColorUniform(own, '_Color');
      expect(color?.r).toBeGreaterThan(color?.g ?? 1);
      expect(color).toEqual(shaderColorUniform(independent, '_Color'));
    }
    expect(customSaberTrailPoints(model)).toEqual({ base: 0.10000000149011612, tip: 1.0045000314712524 });
    for (const side of [0, 1] as const) {
      const trail = createScSaberTrailMaterial(model === 'sc-saber-cc', side, colors[side], texture);
      expect(trail.uniforms._TrailTexture?.value).toBe(texture);
      expect(Boolean(trail.defines.SC_CUSTOM_COLORS)).toBe(model === 'sc-saber-cc');
      const fixed = shaderColorUniform(trail, '_FixedColor')?.clone();
      shaderColorUniform(trail, '_Color')?.setRGB(0, 1, 0);
      expect(shaderColorUniform(trail, '_FixedColor')).toEqual(fixed);
      expect(trail.depthWrite).toBe(false);
      trail.dispose();
    }
    for (const instance of [left, right, other]) for (const material of instance.materials) material.dispose();
  });
}
