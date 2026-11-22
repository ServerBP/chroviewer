import { Result } from 'better-result';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  type WebGLRenderer,
} from 'three';

import { HeckBaseProviderRuntime } from '../core/animation/base-provider';
import { secondsToSongBpmTime, songBpmTimeToSeconds } from '../core/beatmap/bpm';
import type { InfoColorScheme } from '../core/beatmap/info';
import type { ChromaEnvironmentData } from '../core/chroma-environment';
import { DEFAULT_COLORS, resolveColorScheme, type ColorScheme, type Rgb } from '../core/colors';
import { isForcedLightshowMode, shouldShowMapObjects, type LightshowMode } from '../core/lighting/basic-light';
import { sampleNoodlePlayerTrack } from '../core/noodle-runtime';
import { applyReplayHeightEvents, applyReplayNoteEvents, type MapRenderData } from '../core/placement/map-render-data';
import type { AnticheatMark } from '../core/replay/anticheat';
import type { HitScoreVisualizerConfig } from '../core/replay/hit-score-visualizer';
import {
  bladeOf,
  checkCut,
  DEFAULT_HITBOX_RULES,
  goodCutBox,
  hitboxRules,
  noteScale,
  type HitboxRules,
} from '../core/replay/note-hitbox';
import type { Replay, ReplayHeightEvent, ReplayNoteEvent } from '../core/replay/types';
import {
  DEFAULT_REPLAY_CAMERA_SETTINGS,
  type ReplayCameraSettings,
  type ReplaySaberSettings,
} from '../core/viewer-settings';
import { BloomfogPipeline } from './bloomfog/pipeline';
import { fixedCameraPosition, GAMEPLAY_CAMERA_FAR, MAIN_MENU_CAMERA_DISTANCE } from './camera';
import {
  EnvironmentLoadAborted,
  environmentLoadFailure,
  type EnvironmentLoadFailure,
} from './environment/environment-error';
import { loadEnvironment } from './environment/environment-loader';
import type { LoadedEnvironment } from './environment/environment-runtime';
import { EnvironmentLightRuntime } from './map/environment-light-runtime';
import { MapObjectRenderer, type HitboxMode, type NoteHighlight } from './map/map-object-renderer';
import { NoodlePlayerTransform } from './map/noodle-player-transform';
import { createMirrorMaterial, createSkyboxMaterial } from './materials/scene-materials';
import { collectMirrorConsumers, hasVisibleMirrorConsumer } from './mirror/mirror-consumers';
import {
  AFTER_SCREEN_DISPLACEMENT_LAYER,
  MAIN_ONLY_LAYER,
  PlanarMirror,
  SCREEN_DISPLACEMENT_LAYER,
} from './mirror/planar-mirror';
import { PostBloomPipeline } from './post-bloom/pipeline';
import { DEFAULT_QUALITY } from './quality';
import { DEFAULT_RENDER_PERFORMANCE, type RenderPerformanceOptions } from './render-performance';
import type { RenderView } from './renderer-lifecycle';
import type { Figure } from './replay/anticheat-figures';
import { frameAround, type InspectorFocus } from './replay/anticheat-inspector';
import type { Ghost, SwingPath } from './replay/anticheat-overlay';
import { ReplayOrthographicOverlay } from './replay/orthographic-overlay';
import type { InspectView, ReplayCameraMode } from './replay/replay-camera';
import { ReplayView } from './replay/replay-view';

function fullscreenTriangle() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return geometry;
}

/** One good cut checked against its note's box */
export interface CutCheck {
  time: number;
  noteIndex: number;
  dot: boolean;
  hits: boolean;
  /**
   * How much the note's good-cut box would have to grow to touch the box around the blade's sweep, with the note where it
   * stood on the frame before the cut or on the cut's frame, whichever is closer (1 or less: it touched)
   */
  scaleNeeded: number;
  cutScaleNeeded: number;
  previousScaleNeeded: number;
}

export class MapView implements RenderView {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(
    DEFAULT_REPLAY_CAMERA_SETTINGS.replayCameraFov,
    1,
    0.1,
    GAMEPLAY_CAMERA_FAR,
  );
  private readonly playerCameraRoot = new Group();
  private readonly playerCameraHead = new Group();
  private readonly noodlePlayerTransform = new NoodlePlayerTransform();
  private readonly mapRoot = new Group();
  private readonly baseProviders = new HeckBaseProviderRuntime(
    (name, beat) => this.baseProvider(name, beat),
    (beat) => songBpmTimeToSeconds(beat, this.data?.songBpm ?? 120),
  );

  private readonly pipeline: BloomfogPipeline;
  private readonly postBloom: PostBloomPipeline;
  private readonly mirror: PlanarMirror;
  private readonly skybox: Mesh;
  private readonly replayView: ReplayView;
  private readonly replayOrthographicOverlay = new ReplayOrthographicOverlay();
  private readonly mapObjects: MapObjectRenderer;
  private readonly environmentLights = new EnvironmentLightRuntime();
  private environment: LoadedEnvironment | null = null;
  private environmentMirrorConsumers: Mesh[] = [];
  private playerPlatformNodes: Array<{ node: Group; visible: boolean }> = [];
  private environmentRequest: {
    id: string;
    chromaEnvironment?: ChromaEnvironmentData;
    controller: AbortController;
    result: Promise<Result<void, EnvironmentLoadFailure>>;
  } | null = null;

  private lightshowMode: LightshowMode = 'full';
  private gameplayObjectsVisible = true;
  private colors: ColorScheme = DEFAULT_COLORS;
  private songDuration = 0;
  private menuLightshowSeed: number | null = null;
  private orthoCameraEnabled = DEFAULT_REPLAY_CAMERA_SETTINGS.orthoCameraEnabled;
  private screenDisplacementEffects = true;
  private playerPlatformVisible = true;

  private data: MapRenderData | null = null;
  private focusNote = -1;
  private hitboxRules: HitboxRules = DEFAULT_HITBOX_RULES;
  private beatSource: () => number = () => 0;

  constructor(
    quality = DEFAULT_QUALITY,
    private readonly onEnvironmentLoadSettled: () => void = () => undefined,
    performance: RenderPerformanceOptions = DEFAULT_RENDER_PERFORMANCE,
    private readonly orthoOverlayElement: () => HTMLElement | null = () => null,
  ) {
    this.pipeline = new BloomfogPipeline(performance.bloomFogSize);
    this.postBloom = new PostBloomPipeline(performance.postBloomWidth, performance.msaaSamples);
    this.mirror = new PlanarMirror(quality, 6, 400, {
      resolution: performance.mirrorResolution,
      msaaSamples: performance.mirrorMsaaSamples,
    });
    this.camera.position.set(...fixedCameraPosition(DEFAULT_REPLAY_CAMERA_SETTINGS.previewCameraDistance));
    this.scene.matrixAutoUpdate = false;
    this.scene.matrixWorldAutoUpdate = false;
    this.camera.layers.enable(MAIN_ONLY_LAYER);
    this.camera.layers.enable(SCREEN_DISPLACEMENT_LAYER);
    this.camera.layers.enable(AFTER_SCREEN_DISPLACEMENT_LAYER);
    this.playerCameraHead.add(this.camera);
    this.playerCameraRoot.add(this.playerCameraHead);
    this.scene.add(this.playerCameraRoot);

    const fog = this.pipeline.fogUniforms;
    this.mapObjects = new MapObjectRenderer(this.mapRoot, fog, this.postBloom.screenDisplacementTexture, this.camera);

    this.skybox = new Mesh(fullscreenTriangle(), createSkyboxMaterial(fog));
    this.skybox.frustumCulled = false;
    this.skybox.renderOrder = -1000;
    this.scene.add(this.skybox);

    this.mirror.mesh.material = createMirrorMaterial(fog, this.mirror.reflectionTexture);
    this.mirror.mesh.position.set(0, 0, -150);
    this.mirror.mesh.visible = false;
    this.scene.add(this.mirror.mesh);

    this.scene.add(this.mapRoot);
    const directionalLights = this.environmentLights.directionalLights;
    this.replayView = new ReplayView(
      this.camera,
      fog,
      {
        directions: directionalLights.directions,
        colors: directionalLights.colors,
        positions: directionalLights.positions,
        radii: directionalLights.radii,
      },
      () => {
        this.mirror.updateMaterials(this.scene);
      },
    );
    this.replayView.hudRoot.traverse((object) => {
      object.layers.set(MAIN_ONLY_LAYER);
    });
    this.scene.add(this.replayView.hudRoot);
    this.scene.add(this.replayView.root);
    this.mirror.updateMaterials(this.scene);
    void this.replayView.loadHeadset();
  }

  setEnvironment(id: string, chromaEnvironment?: ChromaEnvironmentData): Promise<Result<void, EnvironmentLoadFailure>> {
    if (this.environment?.data.id === id && this.environment.chromaEnvironment === chromaEnvironment) {
      this.environmentRequest?.controller.abort();
      this.environmentRequest = null;
      return Promise.resolve(Result.ok(undefined));
    }
    if (this.environmentRequest?.id === id && this.environmentRequest.chromaEnvironment === chromaEnvironment) {
      return this.environmentRequest.result;
    }
    this.environmentRequest?.controller.abort();
    const controller = new AbortController();
    const result = this.loadAndApplyEnvironment(id, controller, chromaEnvironment);
    this.environmentRequest = { id, chromaEnvironment, controller, result };
    return result;
  }

  private async loadAndApplyEnvironment(
    id: string,
    controller: AbortController,
    chromaEnvironment?: ChromaEnvironmentData,
  ): Promise<Result<void, EnvironmentLoadFailure>> {
    const loadResult = await Result.tryPromise({
      try: () =>
        loadEnvironment(
          id,
          {
            fog: this.pipeline.fogUniforms,
            reflectionTexture: this.mirror.reflectionTexture,
            directionalLights: {
              directions: { value: this.environmentLights.directionalLights.directions },
              colors: { value: this.environmentLights.directionalLights.colors },
              positions: { value: this.environmentLights.directionalLights.positions },
              radii: { value: this.environmentLights.directionalLights.radii },
            },
            songTime: this.environmentLights.songTime,
          },
          controller.signal,
          chromaEnvironment,
        ),
      catch: (cause) => environmentLoadFailure(id, cause),
    });
    if (loadResult.isErr()) {
      if (this.environmentRequest?.controller === controller) {
        this.environmentRequest = null;
        this.onEnvironmentLoadSettled();
      }
      return Result.err(loadResult.error);
    }

    const environment = loadResult.value;
    if (controller.signal.aborted || this.environmentRequest?.controller !== controller) {
      environment.dispose();
      return Result.err(
        new EnvironmentLoadAborted({
          environmentId: id,
          message: `environment ${id} load was cancelled`,
        }),
      );
    }
    if (this.environment !== null) {
      this.scene.remove(this.environment.root);
      this.environment.dispose();
    }
    this.environment = environment;
    this.environmentRequest = null;
    this.playerPlatformNodes = [];
    environment.root.traverse((node) => {
      if (node instanceof Group && /^PlayersPlace(?:\(Clone\))*$/.test(node.name)) {
        this.playerPlatformNodes.push({ node, visible: node.visible });
      }
    });
    this.applyPlayerPlatformVisibility();
    this.environmentMirrorConsumers = collectMirrorConsumers(environment.root);
    this.scene.add(environment.root);
    this.environmentLights.setEnvironment(environment);
    this.mirror.updateMaterials(this.scene);
    this.pipeline.setFogParams(environment.data.fogParams);
    const hasCustomEnvironment =
      chromaEnvironment !== undefined &&
      (Object.keys(chromaEnvironment.materials).length > 0 ||
        chromaEnvironment.enhancements.length > 0 ||
        chromaEnvironment.animations.length > 0 ||
        chromaEnvironment.componentAnimations.length > 0 ||
        chromaEnvironment.fogTrackEvents.length > 0);
    this.pipeline.setBackgroundGradient(hasCustomEnvironment ? null : environment.backgroundGradient);
    this.onEnvironmentLoadSettled();
    return Result.ok(undefined);
  }

  setBeatSource(source: () => number) {
    this.beatSource = source;
  }

  startMenuLightshow(seed: number) {
    const startedAt = performance.now();
    this.menuLightshowSeed = seed;
    this.beatSource = () => (performance.now() - startedAt) / 500;
    this.replayView.setPreviewCameraDistanceOverride(MAIN_MENU_CAMERA_DISTANCE);
    this.environmentLights.setMenuLightshow(seed);
  }

  setLightshowMode(mode: LightshowMode) {
    this.lightshowMode = mode;
    this.environmentLights.setLightshowMode(mode);
    this.updateMapRootVisibility();
    this.replayView.setLightshowMode(mode);
    this.mapObjects.invalidate();
  }

  clear() {
    this.clearMap();
    this.setSongDuration(null);
    this.setReplay(null);
    if (this.menuLightshowSeed !== null) this.startMenuLightshow(this.menuLightshowSeed);
  }

  setReplay(replay: Replay | null, hitScoreVisualizer?: HitScoreVisualizerConfig | null) {
    this.replayView.setReplay(replay, hitScoreVisualizer);
    this.mapObjects.setNoteScale(noteScale(replay?.metadata.modifiers));
    this.hitboxRules =
      replay === null
        ? DEFAULT_HITBOX_RULES
        : hitboxRules(replay.metadata.modifiers, replay.metadata.characteristic, replay.metadata.gameVersion);
    this.mapObjects.setHitboxRules(this.hitboxRules);
    this.baseProviders.reset();
    this.mapObjects.invalidate();
  }

  /** What an anticheat report points at: notes to ring and the saber tip's path over swings */
  setAnticheatMarks(highlights: NoteHighlight[], paths: SwingPath[]) {
    this.mapObjects.setNoteHighlights(highlights);
    this.replayView.setAnticheatPaths(paths);
  }

  /** Other players' replays of the map in an anticheat comparison */
  setAnticheatGhosts(ghosts: Ghost[]) {
    this.replayView.setAnticheatGhosts(ghosts);
  }

  setAnticheatGhostVisible(index: number, visible: boolean) {
    this.replayView.setAnticheatGhostVisible(index, visible);
  }

  /** The cut a reviewer is looking at: its note's boxes where it was cut, the blade's sweep and the arrow's tolerance */
  setAnticheatFocus(focus: { mark: AnticheatMark; tolerance: number | null; color: InspectorFocus['color'] } | null) {
    const note = focus?.mark.note;
    if (focus === null || note === null || note === undefined) {
      this.focusNote = -1;
      this.replayView.setAnticheatFocus(null);
      return;
    }
    this.focusNote = this.mapObjects.noteIndexOf(note, focus.mark.time);
    const dot = this.data?.notes[this.focusNote]?.dot ?? note.direction === 8;
    const poses =
      this.focusNote < 0
        ? null
        : this.posesAtCut(this.focusNote, this.data?.notes[this.focusNote]?.replayEndTime ?? focus.mark.time);
    this.replayView.setAnticheatFocus({ ...focus, dot, rules: this.hitboxRules, noteIndex: this.focusNote, poses });
    this.mapObjects.invalidate();
  }

  /**
   * Where a note was drawn on the frame before a cut and on the cut's frame, in the space replay poses are drawn in. The
   * game tests a cut against the note's box as it stood on one of them, so both are measured.
   */
  private posesAtCut(index: number, time: number): { previous: Matrix4 | null; cut: Matrix4 | null } | null {
    const data = this.data;
    const replay = this.replayView.currentReplay;
    if (data === null || replay === null) return null;
    const around = frameAround(replay.poses, time);
    if (around === null) return null;
    const space = this.replayView.playerSpace;
    const at = (seconds: number) => {
      this.update(secondsToSongBpmTime(seconds, data.songBpm));
      const pose = this.mapObjects.notePose(index);
      if (pose === null || Math.abs(pose.time - seconds) > 0.002) return null;
      space.updateWorldMatrix(true, false);
      return space.matrixWorld.clone().invert().multiply(pose.matrix);
    };
    const previous = at(around.previous.time);
    const cut = at(time);
    return { previous, cut };
  }

  get anticheatInspection() {
    return this.replayView.anticheatInspection;
  }

  setAnticheatInspectView(view: InspectView) {
    this.replayView.setAnticheatInspectView(view);
  }

  setHitboxMode(mode: HitboxMode) {
    this.mapObjects.setHitboxMode(mode);
  }

  setAnticheatFigures(enabled: boolean, figures: Figure[]) {
    this.replayView.setAnticheatFigures(enabled, figures);
  }

  /**
   * Every good cut of the replay against its note's good-cut box: the note placed as drawn on the cut frame, the blade swept
   * from the frame before. Steps through the play in time order, so it takes a few seconds on long maps.
   */
  async checkEveryCut(onProgress?: (done: number, total: number) => void): Promise<CutCheck[]> {
    const data = this.data;
    const replay = this.replayView.currentReplay;
    if (data === null || replay === null) return [];
    const byTime = new Map<number, number>();
    for (const [index, note] of data.notes.entries())
      if (note.replayEndTime !== undefined) byTime.set(note.replayEndTime, index);
    const cuts = replay.notes
      .filter((event) => event.eventType === 1 && byTime.has(event.time))
      .sort((left, right) => left.time - right.time);
    const results: CutCheck[] = [];

    for (const [done, event] of cuts.entries()) {
      const index = byTime.get(event.time) ?? -1;
      const around = frameAround(replay.poses, event.time);
      const note = data.notes[index];
      const poses = note === undefined ? null : this.posesAtCut(index, event.time);
      if (around !== null && note !== undefined && poses !== null && (poses.cut !== null || poses.previous !== null)) {
        const hand = event.saberType === 0 ? 'leftHand' : 'rightHand';
        const shape = note.dot ? 'dot' : 'arrow';
        const blades = [bladeOf(around.previous[hand]), bladeOf(around.current[hand])] as const;
        const scaleAt = (pose: Matrix4 | null, box: ReturnType<typeof goodCutBox>) =>
          pose === null ? Number.POSITIVE_INFINITY : checkCut(pose, box, blades[0], blades[1]).box.scaleNeeded;
        const box = goodCutBox(shape, this.hitboxRules);
        const cutScale = scaleAt(poses.cut, box);
        const previousScale = scaleAt(poses.previous, box);
        const scaleNeeded = Math.min(cutScale, previousScale);
        results.push({
          time: event.time,
          noteIndex: index,
          dot: note.dot,
          scaleNeeded,
          hits: scaleNeeded <= 1,
          cutScaleNeeded: cutScale,
          previousScaleNeeded: previousScale,
        });
      }
      if (done % 40 === 39) {
        onProgress?.(done + 1, cuts.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    onProgress?.(cuts.length, cuts.length);
    this.mapObjects.invalidate();
    return results;
  }

  get matchedAnticheatNotes() {
    return this.mapObjects.matchedHighlights;
  }

  setHitScoreVisualizer(hitScoreVisualizer: HitScoreVisualizerConfig | null) {
    this.replayView.setHitScoreVisualizer(hitScoreVisualizer);
  }

  setGameUIEnabled(enabled: boolean) {
    this.replayView.setGameUIEnabled(enabled);
  }

  setPlayerPlatformVisible(visible: boolean) {
    this.playerPlatformVisible = visible;
    this.applyPlayerPlatformVisibility();
  }

  private applyPlayerPlatformVisibility() {
    for (const platform of this.playerPlatformNodes) {
      platform.node.visible = this.playerPlatformVisible ? platform.visible : false;
    }
    if (this.playerPlatformVisible) this.environment?.enforceChromaRemoval();
  }

  setGameplayNotesVisible(visible: boolean) {
    this.gameplayObjectsVisible = visible;
    this.updateMapRootVisibility();
    this.mapObjects.setGameplayNotesVisible(visible);
  }

  private updateMapRootVisibility() {
    // A showcase hides gameplay objects inside MapObjectRenderer, but its fake
    // walls are part of the lightshow and must keep the map root rendered.
    this.mapRoot.visible = shouldShowMapObjects(this.lightshowMode, this.gameplayObjectsVisible);
  }

  setSongDuration(duration: number | null) {
    this.songDuration = duration ?? 0;
    this.replayView.setSongDuration(duration);
  }

  appendReplayNoteEvents(events: ReplayNoteEvent[]) {
    if (this.data !== null && events.length > 0) {
      applyReplayNoteEvents(this.data, events);
      this.mapObjects.invalidate();
    }
    this.replayView.refreshTimeline();
  }

  appendReplayHeightEvents(events: ReplayHeightEvent[]) {
    if (this.data === null || events.length === 0) return;
    applyReplayHeightEvents(this.data, events);
    this.mapObjects.invalidate();
  }

  setReplayCameraMode(mode: ReplayCameraMode) {
    this.replayView.setCameraMode(mode);
  }

  setReplayCameraSettings(settings: ReplayCameraSettings) {
    this.orthoCameraEnabled = settings.orthoCameraEnabled;
    this.replayOrthographicOverlay.setView(settings.orthoCameraView);
    this.replayView.setCameraSettings(settings);
  }

  setReplaySaberSettings(settings: ReplaySaberSettings) {
    this.replayView.setSaberSettings(settings);
  }

  setScreenDisplacementEffects(enabled: boolean) {
    this.screenDisplacementEffects = enabled;
    this.postBloom.setScreenDisplacementEnabled(enabled);
    this.mapObjects.setScreenDisplacementEffects(enabled);
  }

  setRenderPerformance(performance: RenderPerformanceOptions) {
    this.pipeline.setCaptureSize(performance.bloomFogSize);
    this.postBloom.setPerformance(performance.postBloomWidth, performance.msaaSamples);
    const mirrorChanged = this.mirror.setPerformance(performance.mirrorResolution, performance.mirrorMsaaSamples);
    if (mirrorChanged) this.mirror.updateMaterials(this.scene);
  }

  setPreviewNotesLookAtPlayer(enabled: boolean) {
    this.mapObjects.setPreviewNotesLookAtPlayer(enabled);
  }

  setPreviewHitNotes(enabled: boolean) {
    this.mapObjects.setPreviewHitNotes(enabled);
  }

  setPreviewHitLine(enabled: boolean) {
    this.mapObjects.setPreviewHitLine(enabled);
  }

  setMap(data: MapRenderData, override?: InfoColorScheme) {
    this.replayView.setPreviewCameraDistanceOverride(null);
    this.clearMap();
    this.data = data;
    this.replayView.setMapHasNotes(data.notes.length > 0);
    this.replayView.setNoodleTrailLocalSpace(data.noodle.localSpaceSaberTrail);

    const colors = this.resolveMapColors(override);
    this.colors = colors;
    this.baseProviders.reset();
    this.environmentLights.setMap(data, colors);
    this.replayView.setColors(colors);
    this.mapObjects.setMap(data, colors);
    this.mirror.updateMaterials(this.scene);
  }

  refreshMapColors(override?: InfoColorScheme) {
    if (this.data === null) return;
    const colors = this.resolveMapColors(override);
    this.colors = colors;
    this.baseProviders.reset();
    this.environmentLights.setColors(colors);
    this.replayView.setColors(colors);
    this.mapObjects.setColors(colors);
  }

  private resolveMapColors(override?: InfoColorScheme) {
    return this.environment === null ? DEFAULT_COLORS : resolveColorScheme(this.environment.data.colorScheme, override);
  }

  private clearMap() {
    this.mapObjects.clear();
    this.data = null;
    this.replayView.setMapHasNotes(false);
    this.replayView.setNoodleTrailLocalSpace(false);
    this.environmentLights.clearMap();
    this.mirror.updateMaterials(this.scene);
  }

  private baseProvider(name: string, beat: number): readonly number[] | undefined {
    const data = this.data;
    const color = (value: Rgb): readonly [number, number, number, number] => [value[0], value[1], value[2], 1];
    const colors = this.colors;
    // Map render data already swaps each note's colour index in left-handed
    // mode. Swapping the palette here as well cancelled that transformation.
    if (name === 'baseNote0Color') return color(colors.leftNote);
    if (name === 'baseNote1Color') return color(colors.rightNote);
    if (name === 'baseObstaclesColor') return color(colors.obstacle);
    if (name === 'baseSaberAColor') return color(colors.leftNote);
    if (name === 'baseSaberBColor') return color(colors.rightNote);
    if (name === 'baseEnvironmentColor0') return color(colors.environmentLeft);
    if (name === 'baseEnvironmentColor1') return color(colors.environmentRight);
    if (name === 'baseEnvironmentColorW') return color(colors.environmentWhite);
    if (name === 'baseEnvironmentColor0Boost') return color(colors.environmentLeftBoost);
    if (name === 'baseEnvironmentColor1Boost') return color(colors.environmentRightBoost);
    if (name === 'baseEnvironmentColorWBoost') return color(colors.environmentWhiteBoost);
    const seconds = songBpmTimeToSeconds(beat, data?.songBpm ?? 120);
    if (name === 'baseSongTime') return [seconds];
    if (name === 'baseSongLength') return [this.songDuration];
    if (name === 'basePlayerHeight') return [this.playerHeightAt(seconds)];
    if (data !== null) {
      const movement = data.movementStateAt?.(beat);
      if (name === 'baseNoteJumpMovementSpeed') return [movement?.noteJumpSpeed ?? data.noteJumpSpeed ?? 0];
      if (name === 'baseNoteJumpStartBeatOffset') return [data.noteStartBeatOffset ?? 0];
      if (name === 'baseJumpDistance') return [movement?.jumpDistance ?? 0];
    }
    return this.replayView.baseProvider(name, seconds);
  }

  private playerHeightAt(time: number) {
    const data = this.data;
    if (data === null) return 1.8;
    let low = 0;
    let high = data.replayHeights.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((data.replayHeights[middle]?.time ?? Number.POSITIVE_INFINITY) <= time) low = middle + 1;
      else high = middle;
    }
    return data.replayHeights[low - 1]?.height ?? data.initialPlayerHeight;
  }

  private update(now: number) {
    const data = this.data;
    if (this.environment !== null) {
      const fog = this.environmentLights.update(now, this.baseProviders);
      if (fog !== undefined) this.pipeline.setFogParams(fog);
      if (!this.playerPlatformVisible) this.applyPlayerPlatformVisibility();
    }
    if (data === null) return;
    if (!shouldShowMapObjects(this.lightshowMode, this.gameplayObjectsVisible)) return;
    const replayTime = songBpmTimeToSeconds(now, data.songBpm);
    this.playerCameraRoot.position.set(0, 0, 0);
    this.playerCameraRoot.quaternion.identity();
    this.playerCameraRoot.scale.set(1, 1, 1);
    this.playerCameraHead.position.set(0, 0, 0);
    this.playerCameraHead.quaternion.identity();
    this.playerCameraHead.scale.set(1, 1, 1);
    const rootTrack = sampleNoodlePlayerTrack(data.noodle, 'Root', now, this.baseProviders, data.leftHanded);
    const headTrack = sampleNoodlePlayerTrack(data.noodle, 'Head', now, this.baseProviders, data.leftHanded);
    if (!this.replayView.hasReplay || this.replayView.cameraMode === 'static') {
      this.noodlePlayerTransform.apply(this.playerCameraRoot, rootTrack, data.leftHanded);
      this.noodlePlayerTransform.apply(this.playerCameraHead, headTrack, data.leftHanded);
    }
    this.replayView.update(
      replayTime,
      this.replayView.hasReplay
        ? {
            root: rootTrack,
            head: headTrack,
            leftHand: sampleNoodlePlayerTrack(data.noodle, 'LeftHand', now, this.baseProviders, data.leftHanded),
            rightHand: sampleNoodlePlayerTrack(data.noodle, 'RightHand', now, this.baseProviders, data.leftHanded),
          }
        : undefined,
      data.leftHanded,
    );
    this.mapObjects.update(now, this.replayView, this.baseProviders);
    this.replayView.updateAnticheatInspector(
      replayTime,
      this.focusNote < 0 ? null : this.mapObjects.notePose(this.focusNote),
    );
  }

  render(renderer: WebGLRenderer) {
    this.renderFrame(renderer);
  }

  renderViewport(
    renderer: WebGLRenderer,
    output: { x: number; y: number; width: number; height: number; renderWidth?: number; renderHeight?: number },
  ) {
    this.renderFrame(renderer, output);
  }

  private renderFrame(
    renderer: WebGLRenderer,
    output?: { x: number; y: number; width: number; height: number; renderWidth?: number; renderHeight?: number },
  ) {
    const now = this.environment === null && this.data === null ? 0 : this.beatSource();
    this.update(now);
    this.scene.updateMatrixWorld();
    if (this.environment?.applyConstraints() === true) this.scene.updateMatrixWorld();
    this.environment?.syncInstancedMeshes();
    if (this.environment !== null) this.environmentLights.updateWorldLights(now);
    if (hasVisibleMirrorConsumer(this.environmentMirrorConsumers, this.camera)) {
      this.mirror.render(renderer, this.scene, this.camera, (mirrorRenderer, mirrorCamera) => {
        this.pipeline.render(mirrorRenderer, mirrorCamera, this.environmentLights.lightSegments);
      });
    }
    this.pipeline.render(renderer, this.camera, this.environmentLights.lightSegments);
    this.postBloom.render(
      renderer,
      this.scene,
      this.camera,
      this.mapRoot.visible && this.mapObjects.wallsVisible,
      output,
    );
    if (this.orthoCameraEnabled && this.replayView.hasReplay && !isForcedLightshowMode(this.lightshowMode)) {
      const element = this.orthoOverlayElement();
      if (element !== null) this.renderOrthographicOverlay(renderer, element, now);
    }
  }

  private renderOrthographicOverlay(renderer: WebGLRenderer, element: HTMLElement, beat: number) {
    const environmentRoot = this.environment?.root;
    const environmentVisible = environmentRoot?.visible ?? false;
    const skyboxVisible = this.skybox.visible;
    const mirrorVisible = this.mirror.mesh.visible;
    const hudVisible = this.replayView.hudRoot.visible;
    const fog = this.pipeline.fogUniforms;
    const fogAttenuation = fog._CustomFogAttenuation.value;
    const fogHeight = fog._CustomFogHeightFogHeight.value;
    const fogStartY = fog._CustomFogHeightFogStartY.value;

    try {
      if (environmentRoot !== undefined) environmentRoot.visible = false;
      this.skybox.visible = false;
      this.mirror.mesh.visible = false;
      this.replayView.hudRoot.visible = false;
      this.replayView.setOrthographicOverlayRendering(true);
      fog._CustomFogAttenuation.value = 0;
      fog._CustomFogHeightFogHeight.value = 1;
      fog._CustomFogHeightFogStartY.value = -1_000_000;
      if (this.screenDisplacementEffects) this.mapObjects.setScreenDisplacementEffects(false);
      this.replayOrthographicOverlay.setHalfJumpDistance(this.data?.movementStateAt?.(beat).halfJumpDistance);
      this.replayOrthographicOverlay.render(renderer, this.scene, element);
    } finally {
      if (this.screenDisplacementEffects) this.mapObjects.setScreenDisplacementEffects(true);
      fog._CustomFogAttenuation.value = fogAttenuation;
      fog._CustomFogHeightFogHeight.value = fogHeight;
      fog._CustomFogHeightFogStartY.value = fogStartY;
      this.replayView.setOrthographicOverlayRendering(false);
      this.replayView.hudRoot.visible = hudVisible;
      this.mirror.mesh.visible = mirrorVisible;
      this.skybox.visible = skyboxVisible;
      if (environmentRoot !== undefined) environmentRoot.visible = environmentVisible;
    }
  }

  contextRestored() {
    this.pipeline.invalidate();
  }

  setSize(width: number, height: number) {
    this.replayView.setCameraAspect(width / Math.max(height, 1));
    this.postBloom.setSize(width, height);
  }

  dispose() {
    this.environmentRequest?.controller.abort();
    this.environmentRequest = null;
    if (this.environment !== null) {
      this.scene.remove(this.environment.root);
      this.environment.dispose();
    }
    this.mapObjects.dispose();
    this.replayView.dispose();
    this.replayOrthographicOverlay.dispose();
    for (const object of [this.skybox, this.mirror.mesh]) {
      if (!Array.isArray(object.material)) object.material.dispose();
    }
    this.skybox.geometry.dispose();
    this.mirror.dispose();
    this.pipeline.dispose();
    this.postBloom.dispose();
  }
}
