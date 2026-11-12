export interface GroupHoldTile {
  id: string;
  status: string;
  playing: boolean;
  mapHash: string | null;
  time: number;
}

export interface GroupHoldState {
  /** The map each tile has played on, so a tile that never started cannot hold the others. */
  started: Map<string, string>;
  held: Set<string>;
  blockedSince: Map<string, number>;
}

export function createGroupHoldState(): GroupHoldState {
  return { started: new Map(), held: new Set(), blockedSince: new Map() };
}

/**
 * With wait-for-all sync the tiles of one map play as a group: while one that has played is paused, or briefly
 * reconnecting, the others hold still. When it plays again, everyone continues from its time. Returns the tiles
 * to hold and, when a hold ends, the time the held tiles continue from.
 */
export function advanceGroupHold(
  state: GroupHoldState,
  tiles: GroupHoldTile[],
  mapHash: string | null,
  now: number,
  reconnectWaitMs: number,
) {
  const onMap = mapHash === null ? [] : tiles.filter((tile) => tile.mapHash === mapHash);
  for (const tile of onMap)
    if (tile.status === 'watching' && tile.playing) state.started.set(tile.id, mapHash as string);
  const played = onMap.filter((tile) => state.started.get(tile.id) === mapHash);
  const blocking = new Set<string>();
  for (const tile of played) {
    if (tile.status === 'paused') blocking.add(tile.id);
    else if (tile.status === 'reconnecting') {
      const since = state.blockedSince.get(tile.id) ?? now;
      state.blockedSince.set(tile.id, since);
      if (now - since < reconnectWaitMs) blocking.add(tile.id);
      continue;
    }
    state.blockedSince.delete(tile.id);
  }
  const previous = state.held;
  if (blocking.size > 0) {
    state.held = new Set(played.filter((tile) => !blocking.has(tile.id)).map((tile) => tile.id));
    return { held: state.held, resumeAt: null, resume: [] as string[] };
  }
  state.held = new Set();
  if (previous.size === 0) return { held: state.held, resumeAt: null, resume: [] as string[] };
  const returning = played.filter((tile) => !previous.has(tile.id) && tile.status === 'watching');
  const resumeAt = returning.length > 0 ? Math.min(...returning.map((tile) => tile.time)) : null;
  return { held: state.held, resumeAt, resume: [...previous].filter((id) => played.some((tile) => tile.id === id)) };
}
