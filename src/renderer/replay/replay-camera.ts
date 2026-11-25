import { Euler, Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three';

import { DEFAULT_REPLAY_CAMERA_SETTINGS, type ReplayCameraSettings } from '../../core/viewer-settings';
import { fixedCameraPosition, GAMEPLAY_CAMERA_FAR } from '../camera';

const degToRad = Math.PI / 180;
const maxPortraitFov = 120;
const maxPortraitFovIncrease = 10;
const maxPortraitPullback = 1.5;
const maxSmoothingDistance = 10;
const uprightPitch = degToRad;
const uprightPitchInfluence = 1;

function portraitAmount(aspect: number) {
  return Math.min(Math.max((1 - aspect) / 0.75, 0), 1);
}

export function responsiveReplayCameraFov(fov: number, aspect: number) {
  return Math.min(fov + portraitAmount(aspect) * maxPortraitFovIncrease, maxPortraitFov);
}

export function responsiveReplayCameraPullback(aspect: number) {
  return portraitAmount(aspect) * maxPortraitPullback;
}

export function forceUprightQuaternion(quaternion: Quaternion, euler = new Euler(0, 0, 0, 'YXZ')) {
  euler.setFromQuaternion(quaternion, 'YXZ');
  euler.x = uprightPitch + euler.x * uprightPitchInfluence;
  euler.z = 0;
  return quaternion.setFromEuler(euler);
}

export type ReplayCameraMode = 'static' | 'follow' | 'first-person';

/** Where the camera looks at a cut from while a reviewer inspects it: the normal camera, or close around the cut */
export type InspectView = 'player' | 'close' | 'left' | 'side' | 'right' | 'top';

// Offsets from the cut, in the player's space (the player faces −z)
const INSPECT_OFFSETS: Record<Exclude<InspectView, 'player'>, [number, number, number]> = {
  close: [0.3, 0.35, 2.1],
  left: [-2.5, 0.25, 0.1],
  side: [1.8, 0.6, 1.7],
  right: [2.5, 0.25, 0.1],
  top: [0, 2.7, 0.4],
};

export class ReplayCameraController {
  private readonly position = new Vector3();
  private readonly offset = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly rotationQuaternion = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly headEuler = new Euler(0, 0, 0, 'YXZ');
  private mode: ReplayCameraMode = DEFAULT_REPLAY_CAMERA_SETTINGS.replayCamera;
  private settings: ReplayCameraSettings = DEFAULT_REPLAY_CAMERA_SETTINGS;
  private previewCameraDistanceOverride: number | null = null;
  private forced = false;
  private hasReplay = false;
  private hasMapNotes = false;
  private poseReady = false;
  private replayTime = Number.NEGATIVE_INFINITY;
  private updatedAt = performance.now();
  private inspect: { view: Exclude<InspectView, 'player'>; target: Vector3 } | null = null;
  private followOverride = false;

  constructor(private readonly camera: PerspectiveCamera) {
    this.camera.far = GAMEPLAY_CAMERA_FAR;
    this.camera.updateProjectionMatrix();
  }

  get cameraMode() {
    return this.mode;
  }

  reset() {
    this.poseReady = false;
    this.replayTime = Number.NEGATIVE_INFINITY;
    this.updatedAt = performance.now();
  }

  setMode(mode: ReplayCameraMode) {
    if (mode !== this.mode) this.reset();
    this.mode = mode;
    this.applyFov();
    if (mode === 'static') {
      this.camera.position.set(...fixedCameraPosition(this.staticCameraDistance));
      this.camera.quaternion.identity();
    }
  }

  setSettings(settings: ReplayCameraSettings, forced: boolean, hasReplay: boolean) {
    this.settings = settings;
    this.forced = forced;
    this.hasReplay = hasReplay;
    if (forced) {
      this.applyFov();
      this.camera.position.set(...fixedCameraPosition(this.staticCameraDistance));
      return;
    }
    this.setMode(hasReplay ? settings.replayCamera : 'static');
  }

  setForced(forced: boolean, hasReplay: boolean) {
    this.forced = forced;
    this.hasReplay = hasReplay;
    if (!forced) {
      this.setMode(hasReplay ? this.settings.replayCamera : 'static');
      return;
    }
    this.applyFov();
    this.reset();
    this.camera.position.set(...fixedCameraPosition(this.staticCameraDistance));
    this.camera.quaternion.identity();
  }

  setReplayPresence(hasReplay: boolean) {
    this.hasReplay = hasReplay;
    if (!this.forced) {
      this.setMode(hasReplay ? this.settings.replayCamera : 'static');
      return;
    }
    this.camera.position.set(...fixedCameraPosition(this.staticCameraDistance));
  }

  setMapHasNotes(hasMapNotes: boolean) {
    this.hasMapNotes = hasMapNotes;
    if (!this.hasReplay) this.camera.position.set(...fixedCameraPosition(this.staticCameraDistance));
  }

  setPreviewCameraDistanceOverride(distance: number | null) {
    this.previewCameraDistanceOverride = distance;
    if (!this.hasReplay) this.camera.position.set(...fixedCameraPosition(this.staticCameraDistance));
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.applyFov();
  }

  /** Markers are watched from behind and above: in first person the camera would sit inside the player's own head marker */
  setFollowOverride(enabled: boolean) {
    this.followOverride = enabled;
    this.reset();
  }

  /** Looks at `target` from one of the inspection views, until the view is 'player' or the target is gone */
  setInspect(view: InspectView, target: Vector3 | null) {
    this.inspect = view === 'player' || target === null ? null : { view, target: target.clone() };
    if (this.inspect === null) this.reset();
  }

  update(head: Object3D, time: number) {
    if (this.inspect !== null) {
      this.camera.position.copy(this.inspect.target).add(this.offset.set(...INSPECT_OFFSETS[this.inspect.view]));
      this.camera.lookAt(this.inspect.target);
      return;
    }
    const mode = this.followOverride && this.mode === 'first-person' ? 'follow' : this.mode;
    if (mode === 'first-person') {
      this.updateFirstPerson(head, time);
    } else if (mode === 'follow') {
      head.getWorldPosition(this.position);
      this.camera.position.copy(this.position).add(this.offset.set(0, 0.4, 2.5));
      this.camera.lookAt(this.position.add(this.offset.set(0, 0, -2)));
      this.camera.position.add(this.offset.set(0, 0, this.responsivePullback).applyQuaternion(this.camera.quaternion));
    }
  }

  private updateFirstPerson(head: Object3D, time: number) {
    const settings = this.settings;
    const discontinuous = time < this.replayTime || time - this.replayTime > 0.25;
    const now = performance.now();
    const smoothing = settings.replayCameraSmoothing
      ? Math.min(((now - this.updatedAt) / 1000) * settings.replayCameraSmoothingSpeed, 1)
      : 1;
    this.replayTime = time;
    this.updatedAt = now;
    head.getWorldPosition(this.position);
    this.position.add(
      this.offset.set(settings.replayCameraXOffset, settings.replayCameraYOffset, -settings.replayCameraDepthOffset),
    );
    this.euler.set(
      -settings.replayCameraXRotation * degToRad,
      -settings.replayCameraYRotation * degToRad,
      settings.replayCameraZRotation * degToRad,
      'YXZ',
    );
    head.getWorldQuaternion(this.quaternion);
    if (settings.replayCameraForceUpright) forceUprightQuaternion(this.quaternion, this.headEuler);
    this.quaternion.multiply(this.rotationQuaternion.setFromEuler(this.euler));
    this.position.add(this.offset.set(0, 0, this.responsivePullback).applyQuaternion(this.quaternion));
    const teleported =
      this.poseReady && this.camera.position.distanceToSquared(this.position) > maxSmoothingDistance ** 2;
    const amount = this.poseReady && !discontinuous && !teleported ? smoothing : 1;
    this.camera.position.lerp(this.position, amount);
    this.camera.quaternion.slerp(this.quaternion, amount);
    this.poseReady = true;
  }

  private applyFov() {
    const responsive = !this.forced && this.mode !== 'static';
    this.camera.fov = responsive
      ? responsiveReplayCameraFov(this.settings.replayCameraFov, this.camera.aspect)
      : this.settings.replayCameraFov;
    this.camera.updateProjectionMatrix();
  }

  private get responsivePullback() {
    return !this.forced && this.mode !== 'static' ? responsiveReplayCameraPullback(this.camera.aspect) : 0;
  }

  private get staticCameraDistance() {
    if (this.forced && !this.hasReplay && !this.hasMapNotes) return 0;
    return this.hasReplay
      ? this.settings.fixedCameraDistance
      : (this.previewCameraDistanceOverride ?? this.settings.previewCameraDistance);
  }
}
