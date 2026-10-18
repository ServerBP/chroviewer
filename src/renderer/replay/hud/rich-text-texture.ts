import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

import { parseRichText, type RichTextLine, type RichTextRun } from '../../../core/replay/tmp-rich-text';
import { tekoFontUrl } from './primitives';

/**
 * Flying score text drawn once per distinct (text, colour, size) into a texture that every
 * player in a compositor shares. A flying score is then a single quad, instead of a troika
 * mesh per rich-text run, and layout is exact on the first frame.
 */

const fontFamily = 'ChroviewerHsvTeko';
// Teko has no arrows or emoji; Beat Saber's TMP falls back to other fonts for them too.
const fallbackFamilies =
  'system-ui, "Segoe UI Symbol", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
/** Canvas pixels for one base font size; flying scores rarely exceed this on screen. */
const pixelsPerFontSize = 64;
const maxTextureSize = 2048;
/** Total cached texture area before unused entries are evicted (~96 MB of RGBA). */
const pixelBudget = 24 * 1024 * 1024;
/**
 * Drawing budget per ~frame, shared by every player on the page. New text beyond it waits
 * for the next frame instead of stalling a compositor whose players all start at once.
 */
const renderBudgetMs = 4;
const renderBudgetWindowMs = 16;
/** TMP point size that `<size=N>` and `<cspace=N>` values are measured against, per world unit. */
const pointsPerWorldUnit = 10;

export interface RichTextTexture {
  texture: DataTexture;
  /** Quad size in world units. */
  width: number;
  height: number;
}

interface CacheEntry extends RichTextTexture {
  key: string;
  pixels: number;
  refs: number;
}

const cache = new Map<string, CacheEntry>();
let cachedPixels = 0;
let fontGeneration = 0;
let budgetWindowStart = Number.NEGATIVE_INFINITY;
let budgetSpent = 0;
let fontRequested = false;
let measureContext: CanvasRenderingContext2D | null | undefined;
const scratch: { canvas?: HTMLCanvasElement; halo?: HTMLCanvasElement } = {};

function loadFont() {
  if (fontRequested || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  fontRequested = true;
  const face = new FontFace(fontFamily, `url(${tekoFontUrl})`);
  document.fonts.add(face);
  // Text drawn before the font arrives is cached under the old generation and replaced.
  void face.load().then(
    () => fontGeneration++,
    () => undefined,
  );
}

function canvas2d(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d', { willReadFrequently: true });
}

function measurer() {
  if (measureContext === undefined)
    measureContext = typeof document === 'undefined' ? null : canvas2d(document.createElement('canvas'));
  return measureContext;
}

function fontFor(run: Pick<RichTextRun, 'bold' | 'italic'>, pixels: number) {
  return `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${String(pixels)}px ${fontFamily}, ${fallbackFamilies}`;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined;
function graphemes(text: string) {
  return segmenter === undefined ? [...text] : Array.from(segmenter.segment(text), (part) => part.segment);
}

interface PlacedRun {
  run: RichTextRun;
  x: number;
  width: number;
  pixels: number;
  /** Per-character x offsets when characters are placed individually. */
  characters?: { text: string; x: number; width: number }[];
}

interface PlacedLine {
  runs: PlacedRun[];
  width: number;
  ascent: number;
  descent: number;
  baseline: number;
  align: RichTextLine['align'];
}

const lineMetrics = new Map<string, { ascent: number; descent: number }>();
function metrics(context: CanvasRenderingContext2D, pixels: number) {
  const key = `${String(fontGeneration)}|${String(pixels)}`;
  let value = lineMetrics.get(key);
  if (value === undefined) {
    context.font = fontFor({ bold: false, italic: false }, pixels);
    const measured = context.measureText('Hg');
    const ascent = measured.fontBoundingBoxAscent;
    const descent = measured.fontBoundingBoxDescent;
    value =
      Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0
        ? { ascent, descent }
        : { ascent: pixels * 0.8, descent: pixels * 0.25 };
    if (lineMetrics.size > 512) lineMetrics.clear();
    lineMetrics.set(key, value);
  }
  return value;
}

/** Lays out lines the way TMP does: each line's height comes from its tallest element. */
function layout(context: CanvasRenderingContext2D, lines: RichTextLine[], scale: number) {
  const placed: PlacedLine[] = [];
  let previousDescent = 0;
  let cursor = 0;
  for (const [index, line] of lines.entries()) {
    const startSize = Math.max(line.size, 0.0001) * scale;
    const nextSize = Math.max(lines[index + 1]?.size ?? line.size, 0.0001) * scale;
    const start = metrics(context, startSize);
    let ascent = start.ascent;
    let descent = Math.max(start.descent, metrics(context, nextSize).descent);
    let x = 0;
    const runs: PlacedRun[] = [];
    for (const run of line.runs) {
      const pixels = run.size * scale;
      if (run.advance !== undefined) {
        const width = run.advance * scale;
        runs.push({ run, x, width, pixels });
        x += width;
        continue;
      }
      if (pixels <= 0) continue;
      const runMetrics = metrics(context, pixels);
      const offset = run.baselineOffset * scale;
      ascent = Math.max(ascent, runMetrics.ascent + offset);
      descent = Math.max(descent, runMetrics.descent - offset);
      context.font = fontFor(run, pixels);
      if (run.characterSpacing !== 0 || run.monospace !== undefined || run.rotation !== 0) {
        const characters = graphemes(run.text).map((character) => {
          const width = context.measureText(character).width;
          const advance = (run.monospace === undefined ? width : run.monospace * scale) + run.characterSpacing * scale;
          return { text: character, x: 0, width, advance };
        });
        let characterX = 0;
        for (const character of characters) {
          character.x = characterX;
          characterX += character.advance;
        }
        runs.push({ run, x, width: characterX, pixels, characters });
        x += characterX;
      } else {
        const width = context.measureText(run.text).width;
        runs.push({ run, x, width, pixels });
        x += width;
      }
    }
    const lineHeight = line.lineHeight;
    const baseline =
      index === 0 ? ascent : lineHeight === undefined ? cursor + previousDescent + ascent : cursor + lineHeight * scale;
    placed.push({ runs, width: x, ascent, descent, baseline, align: line.align });
    cursor = baseline;
    previousDescent = descent;
  }
  return placed;
}

function draw(
  context: CanvasRenderingContext2D,
  lines: PlacedLine[],
  baseColor: string,
  originX: number,
  originY: number,
  blockWidth: number,
  scale: number,
  halo: number,
) {
  for (const line of lines) {
    const lineX =
      originX +
      (line.align === 'left' ? 0 : line.align === 'right' ? blockWidth - line.width : (blockWidth - line.width) / 2);
    const baseline = originY + line.baseline;
    for (const placed of line.runs) {
      const { run } = placed;
      const x = lineX + placed.x;
      const y = baseline - run.baselineOffset * scale;
      const color = run.color ?? baseColor;
      // The halo pass is opaque so transparent pixels around glyphs carry the glyph colour.
      context.globalAlpha = halo > 0 ? 1 : run.alpha;
      if (run.mark !== undefined) {
        context.fillStyle = run.mark;
        context.fillRect(x, baseline - line.ascent, placed.width, line.ascent + line.descent);
      }
      if (run.advance !== undefined || run.text === '') continue;
      context.font = fontFor(run, placed.pixels);
      context.fillStyle = color;
      context.strokeStyle = color;
      context.lineWidth = halo * placed.pixels;
      context.lineJoin = 'round';
      if (placed.characters === undefined) {
        if (halo > 0) context.strokeText(run.text, x, y);
        context.fillText(run.text, x, y);
      } else {
        for (const character of placed.characters) {
          const characterX = x + character.x;
          if (run.rotation === 0) {
            if (halo > 0) context.strokeText(character.text, characterX, y);
            context.fillText(character.text, characterX, y);
            continue;
          }
          context.save();
          context.translate(characterX + character.width / 2, y - placed.pixels * 0.3);
          // TMP rotates counter-clockwise for positive angles.
          context.rotate((-run.rotation * Math.PI) / 180);
          if (halo > 0) context.strokeText(character.text, -character.width / 2, placed.pixels * 0.3);
          context.fillText(character.text, -character.width / 2, placed.pixels * 0.3);
          context.restore();
        }
      }
      const thickness = Math.max(1, placed.pixels * 0.06) + halo * placed.pixels;
      if (run.underline) context.fillRect(x, y + placed.pixels * 0.1 - thickness / 2, placed.width, thickness);
      if (run.strikethrough) context.fillRect(x, y - placed.pixels * 0.28 - thickness / 2, placed.width, thickness);
    }
  }
  context.globalAlpha = 1;
}

function sizedCanvas(name: 'canvas' | 'halo', width: number, height: number) {
  let canvas = scratch[name];
  if (canvas === undefined) {
    canvas = document.createElement('canvas');
    scratch[name] = canvas;
  }
  if (canvas.width < width || canvas.height < height) {
    canvas.width = Math.max(canvas.width, width);
    canvas.height = Math.max(canvas.height, height);
  }
  return canvas;
}

function render(text: string, color: string, baseFontSize: number): Omit<CacheEntry, 'key' | 'refs'> | null {
  const context = measurer();
  if (context === null) return null;
  const parsed = parseRichText(text, baseFontSize * pointsPerWorldUnit);
  let scale = pixelsPerFontSize;
  let lines = layout(context, parsed.lines, scale);
  const extent = (placed: PlacedLine[]) => {
    const last = placed.at(-1);
    const maxSize = Math.max(1, ...parsed.lines.flatMap((line) => line.runs.map((run) => run.size)));
    return {
      width: Math.max(1, ...placed.map((line) => line.width)),
      height: last === undefined ? 1 : last.baseline + last.descent,
      // Room for italic overhang and the colour halo.
      padding: Math.ceil(0.25 * maxSize * scale),
    };
  };
  let size = extent(lines);
  const largest = Math.max(size.width, size.height) + size.padding * 2;
  if (largest > maxTextureSize) {
    scale *= maxTextureSize / largest;
    lines = layout(context, parsed.lines, scale);
    size = extent(lines);
  }
  const width = Math.ceil(size.width + size.padding * 2);
  const height = Math.ceil(size.height + size.padding * 2);

  const canvas = sizedCanvas('canvas', width, height);
  const haloCanvas = sizedCanvas('halo', width, height);
  const textContext = canvas2d(canvas);
  const haloContext = canvas2d(haloCanvas);
  if (textContext === null || haloContext === null) return null;
  for (const target of [textContext, haloContext]) {
    target.clearRect(0, 0, width, height);
    target.textBaseline = 'alphabetic';
    target.textAlign = 'left';
  }
  draw(textContext, lines, color, size.padding, size.padding, size.width, scale, 0);
  draw(haloContext, lines, color, size.padding, size.padding, size.width, scale, 0.18);

  // Straight alpha, with colour bled into transparent pixels so filtering and mipmaps
  // do not darken glyph edges. Rows are flipped for the texture's bottom-up origin.
  const glyphs = textContext.getImageData(0, 0, width, height).data;
  const bleed = haloContext.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  for (let row = 0; row < height; row++) {
    const source = row * rowBytes;
    const target = (height - 1 - row) * rowBytes;
    for (let column = 0; column < rowBytes; column += 4) {
      const from = glyphs[source + column + 3] === 0 ? bleed : glyphs;
      data[target + column] = from[source + column] ?? 0;
      data[target + column + 1] = from[source + column + 1] ?? 0;
      data[target + column + 2] = from[source + column + 2] ?? 0;
      data[target + column + 3] = glyphs[source + column + 3] ?? 0;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  // Centre the text block: equal padding keeps its middle at the quad's middle, as TMP's
  // middle alignment does with line metrics.
  const worldPerPixel = baseFontSize / scale;
  return { texture, width: width * worldPerPixel, height: height * worldPerPixel, pixels: width * height };
}

function evict() {
  for (const [key, entry] of cache) {
    if (cachedPixels <= pixelBudget) return;
    if (entry.refs > 0) continue;
    cache.delete(key);
    cachedPixels -= entry.pixels;
    entry.texture.dispose();
  }
}

/**
 * A shared texture for this text; pair every call with `releaseRichTextTexture`.
 * 'deferred' means this frame's drawing budget is spent: ask again next frame.
 */
export function acquireRichTextTexture(
  text: string,
  color: string,
  baseFontSize: number,
): RichTextTexture | 'deferred' | null {
  loadFont();
  const key = `${String(fontGeneration)}|${String(baseFontSize)}|${color}|${text}`;
  let entry = cache.get(key);
  if (entry === undefined) {
    const now = performance.now();
    if (now - budgetWindowStart > renderBudgetWindowMs) {
      budgetWindowStart = now;
      budgetSpent = 0;
    }
    if (budgetSpent >= renderBudgetMs) return 'deferred';
    const rendered = render(text, color, baseFontSize);
    budgetSpent += performance.now() - now;
    if (rendered === null) return null;
    entry = { ...rendered, key, refs: 0 };
    cachedPixels += entry.pixels;
    evict();
  } else {
    // Most recently used entries are evicted last.
    cache.delete(key);
  }
  cache.set(key, entry);
  entry.refs++;
  return entry;
}

export function releaseRichTextTexture(texture: RichTextTexture) {
  const entry = texture as CacheEntry;
  entry.refs = Math.max(0, entry.refs - 1);
  if (cachedPixels > pixelBudget) evict();
}
