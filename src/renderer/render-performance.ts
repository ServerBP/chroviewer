import type { MirrorQuality } from './quality';

export const DEFAULT_MAX_FPS = 120;
export const DEFAULT_MSAA_SAMPLES = 4;
export const DEFAULT_MIRROR_MSAA_SAMPLES = 2;
export const DEFAULT_POST_BLOOM_WIDTH = 928;
export const DEFAULT_BLOOM_FOG_SIZE = 512;

export interface RenderPerformanceOptions {
  maxFps: number;
  msaaSamples: number;
  mirrorResolution?: number;
  mirrorMsaaSamples?: number;
  postBloomWidth: number;
  bloomFogSize: number;
  outputWidth?: number;
  outputHeight?: number;
}

export const DEFAULT_RENDER_PERFORMANCE: RenderPerformanceOptions = {
  maxFps: DEFAULT_MAX_FPS,
  msaaSamples: DEFAULT_MSAA_SAMPLES,
  postBloomWidth: DEFAULT_POST_BLOOM_WIDTH,
  bloomFogSize: DEFAULT_BLOOM_FOG_SIZE,
};

export const BROADCAST_RENDER_PERFORMANCE: RenderPerformanceOptions = {
  maxFps: 60,
  msaaSamples: 2,
  mirrorResolution: 0,
  mirrorMsaaSamples: 0,
  postBloomWidth: 640,
  bloomFogSize: 256,
};

export function mirrorResolutionForQuality(quality: MirrorQuality) {
  if (quality === 'none') return 0;
  if (quality === 'low') return 512;
  if (quality === 'medium') return 1024;
  return 2048;
}
