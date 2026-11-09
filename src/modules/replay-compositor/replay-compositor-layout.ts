export type ReplayCompositorLayout = 'auto' | 'columns' | 'rows';

export interface ReplayTileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutPlayer {
  id: string;
  side: number;
}

const TILE_ASPECT = 16 / 9;

// Columns and rows of a grid for count tiles in a region, keeping tiles closest to 16:9.
// Ties go to the squarer grid, so four players become 2x2 rather than a strip
function bestGrid(count: number, width: number, height: number) {
  let best = { columns: 1, rows: count, area: -1, squareness: Infinity };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const fittedWidth = Math.min(cellWidth, cellHeight * TILE_ASPECT);
    const area = Math.round(fittedWidth * (fittedWidth / TILE_ASPECT));
    const squareness = Math.abs(columns - rows);
    if (area > best.area || (area === best.area && squareness < best.squareness)) {
      best = { columns, rows, area, squareness };
    }
  }
  return best;
}

function fillRegion(ids: string[], region: ReplayTileRect, gap: number, tiles: Map<string, ReplayTileRect>) {
  if (ids.length === 0) return;
  const { columns, rows } = bestGrid(ids.length, region.width, region.height);
  const cellWidth = (region.width - gap * (columns - 1)) / columns;
  const cellHeight = (region.height - gap * (rows - 1)) / rows;
  ids.forEach((id, index) => {
    const row = Math.floor(index / columns);
    const inRow = row === rows - 1 ? ids.length - row * columns : columns;
    // A short last row is centred instead of leaving a hole on one side
    const offset = ((columns - inRow) * (cellWidth + gap)) / 2;
    const column = index % columns;
    tiles.set(id, {
      x: Math.round(region.x + offset + column * (cellWidth + gap)),
      y: Math.round(region.y + row * (cellHeight + gap)),
      width: Math.max(1, Math.round(cellWidth)),
      height: Math.max(1, Math.round(cellHeight)),
    });
  });
}

/**
 * Splits the view between the two sides of a match: left and right, or top and bottom when each
 * side has three players (3v3), where columns would make every tile tall and narrow. Each side's
 * players share their half in the grid that keeps tiles closest to 16:9. A focused player fills
 * the whole view.
 */
export function layoutReplayTiles(
  players: LayoutPlayer[],
  width: number,
  height: number,
  options: { layout?: ReplayCompositorLayout; focus?: string | null; gap?: number } = {},
) {
  const tiles = new Map<string, ReplayTileRect>();
  if (width <= 0 || height <= 0 || players.length === 0) return tiles;
  const gap = options.gap ?? 2;
  const focused =
    options.focus === undefined || options.focus === null
      ? undefined
      : players.find((player) => player.id === options.focus);
  if (focused !== undefined) {
    tiles.set(focused.id, { x: 0, y: 0, width, height });
    return tiles;
  }

  const sides = [...new Set(players.map((player) => player.side))].sort((left, right) => left - right);
  const groups = sides.map((side) => players.filter((player) => player.side === side).map((player) => player.id));
  const [only] = groups;
  if (groups.length === 1 && only !== undefined) {
    fillRegion(only, { x: 0, y: 0, width, height }, gap, tiles);
    return tiles;
  }

  const layout =
    options.layout === undefined || options.layout === 'auto'
      ? groups.every((group) => group.length === 3)
        ? 'rows'
        : 'columns'
      : options.layout;
  groups.forEach((group, index) => {
    const region =
      layout === 'rows'
        ? {
            x: 0,
            y: Math.round((index * (height + gap)) / groups.length),
            width,
            height: Math.round((height - gap * (groups.length - 1)) / groups.length),
          }
        : {
            x: Math.round((index * (width + gap)) / groups.length),
            y: 0,
            width: Math.round((width - gap * (groups.length - 1)) / groups.length),
            height,
          };
    fillRegion(group, region, gap, tiles);
  });
  return tiles;
}
