import { Color, WebGLRenderer } from 'three';

import type { MapView } from './map-view';
import type { RenderPerformanceOptions } from './render-performance';
import { clampRenderScale } from './render-scale';

export interface MultiviewTile {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

interface Entry {
  view: MapView;
  tile: MultiviewTile;
  renderScale: number;
  performance: RenderPerformanceOptions;
  sizedWidth: number;
  sizedHeight: number;
}

export interface SharedViewerLifecycle {
  setPerformance(performance: RenderPerformanceOptions): void;
  setRenderScale(scale: number): void;
}

export class MultiviewRendererHost {
  private readonly renderer: WebGLRenderer;
  private readonly entries = new Map<string, Entry>();
  private readonly pendingTiles = new Map<string, MultiviewTile>();
  private readonly clearColor = new Color(0x000000);
  private resizeObserver: ResizeObserver | null = null;
  private frameHandle: number | null = null;
  private contextLost = false;
  private width = 1;
  private height = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.scheduleFrame();
  }

  register(
    id: string,
    view: MapView,
    performance: RenderPerformanceOptions,
    renderScale: number,
  ): SharedViewerLifecycle {
    const entry: Entry = {
      view,
      tile: this.pendingTiles.get(id) ?? { x: 0, y: 0, width: 1, height: 1, visible: false },
      renderScale: clampRenderScale(renderScale),
      performance: { ...performance },
      sizedWidth: -1,
      sizedHeight: -1,
    };
    this.entries.set(id, entry);
    return {
      setPerformance: (next) => {
        entry.performance = { ...next };
        view.setRenderPerformance(next);
        entry.sizedWidth = -1;
      },
      setRenderScale: (scale) => {
        entry.renderScale = clampRenderScale(scale);
        entry.sizedWidth = -1;
      },
    };
  }

  unregister(id: string, view: MapView) {
    const entry = this.entries.get(id);
    if (entry?.view === view) this.entries.delete(id);
  }

  setTile(id: string, tile: MultiviewTile) {
    const normalized = {
      x: Math.round(tile.x),
      y: Math.round(tile.y),
      width: Math.max(1, Math.round(tile.width)),
      height: Math.max(1, Math.round(tile.height)),
      visible: tile.visible,
    };
    this.pendingTiles.set(id, normalized);
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    entry.tile = normalized;
  }

  private readonly resize = () => {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, Math.round(parent?.clientWidth ?? innerWidth));
    const height = Math.max(1, Math.round(parent?.clientHeight ?? innerHeight));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
  };

  private readonly frame = () => {
    this.frameHandle = null;
    if (this.contextLost || document.hidden) return;
    this.scheduleFrame();
    this.resize();
    this.renderer.setRenderTarget(null);
    this.renderer.setScissorTest(false);
    this.renderer.setClearColor(this.clearColor, 0);
    this.renderer.clear(true, true, true);
    for (const entry of this.entries.values()) {
      const tile = entry.tile;
      if (!tile.visible || tile.width <= 0 || tile.height <= 0) continue;
      const renderWidth = Math.max(1, Math.round(tile.width * entry.renderScale));
      const renderHeight = Math.max(1, Math.round(tile.height * entry.renderScale));
      if (renderWidth !== entry.sizedWidth || renderHeight !== entry.sizedHeight) {
        entry.sizedWidth = renderWidth;
        entry.sizedHeight = renderHeight;
        entry.view.setSize(renderWidth, renderHeight);
      }
      entry.view.renderViewport(this.renderer, {
        x: tile.x,
        y: this.height - tile.y - tile.height,
        width: tile.width,
        height: tile.height,
        renderWidth,
        renderHeight,
      });
    }
  };

  private scheduleFrame() {
    if (this.frameHandle !== null || this.contextLost || document.hidden) return;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  };

  private readonly handleContextRestored = () => {
    this.contextLost = false;
    for (const entry of this.entries.values()) entry.view.contextRestored();
    this.scheduleFrame();
  };

  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    } else {
      this.resize();
      this.scheduleFrame();
    }
  };

  dispose() {
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.entries.clear();
    this.pendingTiles.clear();
    this.renderer.dispose();
  }
}
