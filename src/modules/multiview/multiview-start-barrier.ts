export type CompositorSyncType = 'slow' | 'wait-for-all';
export const defaultCompositorWaitSeconds = 30;
export const maximumCompositorWaitSeconds = 60;
/** A stream joined mid-song (an overlay reload) only waits for the tiles that join with it. */
export const lateJoinWaitSeconds = 3;
const groupClockLifetimeMs = 1500;

interface SyncPlayer {
  id: string;
  playerId: string;
  visible: boolean;
  settings: Record<string, string | number | boolean>;
}

export function compositorSyncSettings(players: SyncPlayer[]) {
  const visible = players.filter((player) => player.visible);
  const type: CompositorSyncType =
    visible.length > 0 && visible.every((player) => player.settings.compositorSyncType === 'wait-for-all')
      ? 'wait-for-all'
      : 'slow';
  const waitSeconds = Math.min(
    ...visible.map((player) => {
      const value = Number(player.settings.compositorWaitSeconds ?? defaultCompositorWaitSeconds);
      return Number.isFinite(value)
        ? Math.min(maximumCompositorWaitSeconds, Math.max(1, value))
        : defaultCompositorWaitSeconds;
    }),
    maximumCompositorWaitSeconds,
  );
  return { type, waitSeconds };
}

export interface BufferedStartParticipant {
  ready: boolean;
  firstFrameTime: number;
  latestFrameTime: number;
  playbackRate: number;
  minimumBufferSeconds?: number;
  start: (time: number, startedAt: number) => void;
}

interface Member {
  mapKey: string;
  streamId: string;
  participant?: BufferedStartParticipant;
}

type BarrierPhase = 'idle' | 'waiting' | 'released' | 'fallback';

/** Where the tiles that play together are, published by the compositor for streams that join later. */
export interface MultiviewGroupClock {
  mapHash: string;
  time: number;
  observedAt: number;
  playbackRate: number;
  playing: boolean;
}

/** A startup-only barrier. No timers or seeks are used once playback has begun. */
export class MultiviewStartBarrier {
  private ids: string[] = [];
  private signature = '';
  private type: CompositorSyncType = 'slow';
  private members = new Map<string, Member>();
  private phase: BarrierPhase = 'idle';
  private mapKey = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private group: MultiviewGroupClock | null = null;
  private held = new Set<string>();
  waitSeconds = defaultCompositorWaitSeconds;

  constructor(private readonly now: () => number = () => performance.now()) {}

  configure(players: SyncPlayer[]) {
    const settings = compositorSyncSettings(players);
    const visible = players.filter((player) => player.visible);
    const signature = JSON.stringify({ settings, players: visible.map((player) => [player.id, player.playerId]) });
    if (signature === this.signature) return;
    this.signature = signature;
    this.release(false);
    this.type = settings.type;
    this.waitSeconds = settings.waitSeconds;
    this.ids = visible.map((player) => player.id);
    this.members.clear();
    this.held.clear();
    this.phase = 'idle';
  }

  get enabled() {
    return this.type === 'wait-for-all';
  }

  begin(id: string, streamId: string, mapKey: string, lateJoin = false) {
    if (!this.enabled || !this.ids.includes(id)) return;
    const previous = this.members.get(id);
    if (previous?.streamId === streamId && previous.mapKey === mapKey) return;
    if (
      this.phase === 'idle' ||
      ((this.phase === 'released' || this.phase === 'fallback') && (previous !== undefined || this.mapKey !== mapKey))
    ) {
      this.clearTimer();
      this.members.clear();
      this.mapKey = mapKey;
      this.phase = 'waiting';
      const seconds = lateJoin ? Math.min(this.waitSeconds, lateJoinWaitSeconds) : this.waitSeconds;
      this.timer = setTimeout(() => this.releaseReady(), seconds * 1000);
    }
    this.members.set(id, { mapKey, streamId });
    if (this.phase === 'waiting' && mapKey !== this.mapKey) this.release(false);
  }

  isWaitingFor(id: string, streamId: string) {
    return this.phase === 'waiting' && this.members.get(id)?.streamId === streamId;
  }

  /** Called by existing stream/buffer ticks, never by the WebGL frame loop. */
  update(id: string, streamId: string, participant: BufferedStartParticipant) {
    const member = this.members.get(id);
    if (member?.streamId !== streamId || this.phase !== 'waiting') return false;
    member.participant = participant;
    const ready = this.ids.map((key) => this.members.get(key)?.participant);
    if (ready.every((entry): entry is BufferedStartParticipant => entry?.ready === true)) {
      const first = ready[0];
      if (first !== undefined && ready.every((entry) => entry.playbackRate === first.playbackRate)) {
        const target = Math.max(0, ...ready.map((entry) => entry.firstFrameTime));
        if (ready.every((entry) => entry.latestFrameTime - target >= (entry.minimumBufferSeconds ?? 0.05)))
          this.release(true);
      } else this.release(false);
    }
    return this.phase === 'waiting';
  }

  /** On timeout the streams that are ready start together; the rest join the group once they have its time buffered. */
  private releaseReady() {
    if (this.phase !== 'waiting') return;
    const ready = [...this.members.values()]
      .map((member) => member.participant)
      .filter((entry): entry is BufferedStartParticipant => entry?.ready === true);
    const first = ready[0];
    if (first === undefined || !ready.every((entry) => entry.playbackRate === first.playbackRate)) {
      this.release(false);
      return;
    }
    const target = Math.max(0, ...ready.map((entry) => entry.firstFrameTime));
    const startable = ready.filter((entry) => entry.latestFrameTime - target >= (entry.minimumBufferSeconds ?? 0.05));
    this.clearTimer();
    this.phase = startable.length > 0 ? 'released' : 'fallback';
    const startedAt = this.now();
    for (const entry of startable) entry.start(target, startedAt);
  }

  /** The group's song time now, for a stream joining the map after the group started; null when nobody plays it. */
  groupTime(mapHash: string) {
    const group = this.group;
    if (!this.enabled || group === null || mapHash === '' || group.mapHash !== mapHash.toLowerCase()) return null;
    // The compositor republishes ten times a second; an old clock means nobody is playing this map any more.
    if (this.now() - group.observedAt > groupClockLifetimeMs) return null;
    const elapsed = group.playing ? ((this.now() - group.observedAt) / 1000) * group.playbackRate : 0;
    return group.time + elapsed;
  }

  setGroupClock(clock: MultiviewGroupClock | null) {
    this.group = clock === null ? null : { ...clock, mapHash: clock.mapHash.toLowerCase() };
  }

  /** Tiles held while another tile of the group is paused; they stay still until it plays again. */
  setHeld(ids: Iterable<string>) {
    this.held = new Set(ids);
  }

  isHeld(id: string) {
    return this.enabled && this.held.has(id);
  }

  private release(aligned: boolean) {
    if (this.phase !== 'waiting') return;
    this.clearTimer();
    this.phase = aligned ? 'released' : 'fallback';
    const ready = [...this.members.values()]
      .map((member) => member.participant)
      .filter((entry): entry is BufferedStartParticipant => entry?.ready === true);
    const target = Math.max(0, ...ready.map((entry) => entry.firstFrameTime));
    // Never start beyond data a stream has received. Incompatible buffers use normal startup.
    if (aligned && ready.some((entry) => entry.latestFrameTime < target + 0.05)) {
      this.phase = 'fallback';
      return;
    }
    const startedAt = this.now();
    if (aligned) for (const entry of ready) entry.start(target, startedAt);
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose() {
    this.release(false);
    this.clearTimer();
    this.members.clear();
    this.held.clear();
    this.group = null;
  }
}
