/**
 * The subset of TextMeshPro rich text that Beat Saber's flying score text can show.
 * Tag semantics follow TMP_Text: sizes are relative to the component's font size (not
 * to an enclosing <size>), colours carry their own alpha, <alpha> only changes alpha,
 * and anything that is not a valid tag is drawn literally (e.g. "<115>").
 */

export type RichTextAlign = 'left' | 'center' | 'right';

export interface RichTextRun {
  text: string;
  /** Font size relative to the component's base font size. */
  size: number;
  /** `#rrggbb` from a colour tag; undefined uses the judgment colour. */
  color?: string;
  /** 0..1 from colour/alpha tags. */
  alpha: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  mark?: string;
  /** Baseline shift in base font sizes (sup/sub/voffset). */
  baselineOffset: number;
  /** Extra advance after each character, in base font sizes. */
  characterSpacing: number;
  /** Fixed advance per character, in base font sizes. */
  monospace?: number;
  /** Per-character rotation in degrees. */
  rotation: number;
  /** Horizontal space with no glyphs (<space=…>), in base font sizes. */
  advance?: number;
}

export interface RichTextLine {
  runs: RichTextRun[];
  /** Size in effect where the line starts; empty lines still take up this height. */
  size: number;
  align: RichTextAlign;
  /** <line-height> override, in base font sizes. */
  lineHeight?: number;
}

export interface RichText {
  lines: RichTextLine[];
  /** Visible characters without markup, used to skip effects that would draw nothing. */
  plain: string;
}

// TMP's built-in colour names.
const namedColors: Record<string, string> = {
  red: '#ff0000',
  lightblue: '#add8e6',
  blue: '#0000ff',
  grey: '#808080',
  black: '#000000',
  green: '#00ff00',
  white: '#ffffff',
  orange: '#ff8000',
  purple: '#a020f0',
  yellow: '#ffff00',
};

// Valid TMP tags that change nothing we can draw (fonts, sprites, links, layout boxes).
const ignoredTags = new Set([
  'font',
  'material',
  'sprite',
  'style',
  'link',
  'gradient',
  'width',
  'margin',
  'margin-left',
  'margin-right',
  'indent',
  'line-indent',
  'pos',
  'page',
  'nobr',
  'font-weight',
  'zwsp',
  'zwj',
  'nbsp',
  'action',
  'a',
]);

const maxTagLength = 128;

interface ParsedColor {
  rgb: string;
  alpha?: number;
}

function unquote(value: string) {
  const trimmed = value.trim();
  return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
}

function parseHexColor(value: string): ParsedColor | null {
  if (!/^#[\da-f]+$/i.test(value)) return null;
  const hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a] = [...hex].map((digit) => digit + digit);
    return { rgb: `#${r}${g}${b}`.toLowerCase(), alpha: a === undefined ? 1 : Number.parseInt(a, 16) / 255 };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      rgb: `#${hex.slice(0, 6)}`.toLowerCase(),
      alpha: hex.length === 8 ? Number.parseInt(hex.slice(6), 16) / 255 : 1,
    };
  }
  return null;
}

function parseColor(value: string): ParsedColor | null {
  const color = unquote(value);
  if (color.startsWith('#')) return parseHexColor(color);
  const named = namedColors[color.toLowerCase()];
  return named === undefined ? null : { rgb: named, alpha: 1 };
}

type Unit = 'em' | 'percent' | 'points';

/** TMP numeric tag values: `1.5em`, `150%`, `12`, `+2`, `-2`, `12px`. */
function parseUnitValue(value: string): { value: number; unit: Unit; relative: boolean } | null {
  const match = /^([+-]?)(\d*\.?\d+)\s*(em|%|px)?$/i.exec(unquote(value));
  if (match === null) return null;
  const amount = Number(match[2]) * (match[1] === '-' ? -1 : 1);
  const suffix = match[3]?.toLowerCase();
  return {
    value: amount,
    unit: suffix === 'em' ? 'em' : suffix === '%' ? 'percent' : 'points',
    relative: match[1] !== '',
  };
}

interface State {
  sizes: number[];
  colors: { rgb?: string; alpha: number }[];
  alpha: number;
  bold: number;
  italic: number;
  underline: number;
  strikethrough: number;
  marks: string[];
  scripts: { scale: number; offset: number }[];
  voffset: number[];
  cspace: number[];
  mspace: number[];
  rotation: number[];
  lineHeight?: number;
  align: RichTextAlign[];
  textCase: ('upper' | 'lower' | 'smallcaps' | undefined)[];
}

/** Converts TMP control sequences the way TMP_Text.parseCtrlCharacters does. */
function decodeControlCharacters(source: string) {
  return source.replace(/\\(n|r|t|u[\da-fA-F]{4}|U[\da-fA-F]{8})/g, (match, sequence: string) => {
    if (sequence === 'n') return '\n';
    if (sequence === 'r') return '';
    if (sequence === 't') return '\t';
    const code = Number.parseInt(sequence.slice(1), 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

export function parseRichText(source: string, basePointSize: number): RichText {
  const value = decodeControlCharacters(source);
  const state: State = {
    sizes: [1],
    colors: [{ alpha: 1 }],
    alpha: 1,
    bold: 0,
    italic: 0,
    underline: 0,
    strikethrough: 0,
    marks: [],
    scripts: [{ scale: 1, offset: 0 }],
    voffset: [0],
    cspace: [0],
    mspace: [],
    rotation: [0],
    align: ['center'],
    textCase: [undefined],
  };
  const lines: RichTextLine[] = [];
  let line: RichTextLine = { runs: [], size: 1, align: 'center' };
  let lineHasContent = false;
  let plain = '';

  const size = () => (state.sizes.at(-1) ?? 1) * (state.scripts.at(-1)?.scale ?? 1);
  const toBase = (amount: { value: number; unit: Unit }, relativeTo: number) =>
    amount.unit === 'em'
      ? amount.value * relativeTo
      : amount.unit === 'percent'
        ? (amount.value / 100) * relativeTo
        : amount.value / basePointSize;

  function startLine() {
    line = { runs: [], size: size(), align: state.align.at(-1) ?? 'center', lineHeight: state.lineHeight };
    lineHasContent = false;
  }

  function pushRun(text: string, scale: number, advance?: number) {
    const color = state.colors.at(-1);
    const run: RichTextRun = {
      text,
      size: scale,
      alpha: state.alpha,
      bold: state.bold > 0,
      italic: state.italic > 0,
      underline: state.underline > 0,
      strikethrough: state.strikethrough > 0,
      baselineOffset: (state.scripts.at(-1)?.offset ?? 0) + (state.voffset.at(-1) ?? 0),
      characterSpacing: state.cspace.at(-1) ?? 0,
      rotation: state.rotation.at(-1) ?? 0,
    };
    if (color?.rgb !== undefined) run.color = color.rgb;
    const mark = state.marks.at(-1);
    if (mark !== undefined) run.mark = mark;
    const monospace = state.mspace.at(-1);
    if (monospace !== undefined) run.monospace = monospace;
    if (advance !== undefined) run.advance = advance;
    const previous = line.runs.at(-1);
    if (
      advance === undefined &&
      previous !== undefined &&
      previous.advance === undefined &&
      previous.size === run.size &&
      previous.color === run.color &&
      previous.alpha === run.alpha &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.underline === run.underline &&
      previous.strikethrough === run.strikethrough &&
      previous.mark === run.mark &&
      previous.baselineOffset === run.baselineOffset &&
      previous.characterSpacing === run.characterSpacing &&
      previous.monospace === run.monospace &&
      previous.rotation === run.rotation
    ) {
      previous.text += text;
    } else {
      line.runs.push(run);
    }
  }

  function appendText(text: string) {
    for (const [index, part] of text.split('\n').entries()) {
      if (index > 0) {
        lines.push(line);
        startLine();
        plain += '\n';
      }
      if (part === '') continue;
      if (!lineHasContent) {
        // TMP takes a line's alignment from where its first character is.
        line.align = state.align.at(-1) ?? 'center';
        lineHasContent = true;
      }
      const expanded = part.replaceAll('\t', '    ');
      plain += expanded;
      const textCase = state.textCase.at(-1);
      if (textCase === 'upper') pushRun(expanded.toUpperCase(), size());
      else if (textCase === 'lower') pushRun(expanded.toLowerCase(), size());
      else if (textCase === 'smallcaps') {
        // Lower-case letters become capitals at 80%, as in TMP.
        for (const piece of expanded.match(/\p{Ll}+|[^\p{Ll}]+/gu) ?? []) {
          const lower = /\p{Ll}/u.test(piece);
          pushRun(lower ? piece.toUpperCase() : piece, lower ? size() * 0.8 : size());
        }
      } else pushRun(expanded, size());
    }
  }

  /** Applies a tag; false means TMP would not recognise it, so it is drawn as text. */
  function applyTag(raw: string) {
    const tag = raw.trim();
    if (tag === '') return false;
    if (tag.startsWith('#')) {
      const color = parseHexColor(tag);
      if (color === null) return false;
      state.colors.push({ rgb: color.rgb, alpha: color.alpha ?? 1 });
      state.alpha = color.alpha ?? 1;
      return true;
    }
    const closing = tag.startsWith('/');
    const body = closing ? tag.slice(1).trim() : tag;
    const separator = body.search(/[=\s]/);
    const name = (separator === -1 ? body : body.slice(0, separator)).toLowerCase();
    const argument = separator === -1 ? '' : body.slice(separator).replace(/^\s*=?\s*/, '');
    const pop = <T>(stack: T[]) => {
      if (stack.length > 1) stack.pop();
    };

    if (closing) {
      switch (name) {
        case 'size':
          pop(state.sizes);
          return true;
        case 'color': {
          pop(state.colors);
          state.alpha = state.colors.at(-1)?.alpha ?? 1;
          return true;
        }
        case 'alpha':
          state.alpha = state.colors.at(-1)?.alpha ?? 1;
          return true;
        case 'b':
          state.bold = Math.max(0, state.bold - 1);
          return true;
        case 'i':
          state.italic = Math.max(0, state.italic - 1);
          return true;
        case 'u':
          state.underline = Math.max(0, state.underline - 1);
          return true;
        case 's':
        case 'strikethrough':
          state.strikethrough = Math.max(0, state.strikethrough - 1);
          return true;
        case 'mark':
          state.marks.pop();
          return true;
        case 'sup':
        case 'sub':
          pop(state.scripts);
          return true;
        case 'voffset':
          pop(state.voffset);
          return true;
        case 'cspace':
          pop(state.cspace);
          return true;
        case 'mspace':
          state.mspace.pop();
          return true;
        case 'rotate':
          pop(state.rotation);
          return true;
        case 'line-height':
          state.lineHeight = undefined;
          return true;
        case 'align':
          pop(state.align);
          return true;
        case 'uppercase':
        case 'allcaps':
        case 'lowercase':
        case 'smallcaps':
          pop(state.textCase);
          return true;
        default:
          return ignoredTags.has(name);
      }
    }

    switch (name) {
      case 'size': {
        const amount = parseUnitValue(argument);
        if (amount === null) return false;
        // Relative to the component's font size, not to an enclosing <size>.
        const next = amount.relative && amount.unit === 'points' ? 1 + amount.value / basePointSize : toBase(amount, 1);
        state.sizes.push(Math.max(0, next));
        return true;
      }
      case 'color': {
        const color = parseColor(argument);
        if (color === null) return false;
        state.colors.push({ rgb: color.rgb, alpha: color.alpha ?? 1 });
        state.alpha = color.alpha ?? 1;
        return true;
      }
      case 'alpha': {
        const match = /^#([\da-f]{2})$/i.exec(unquote(argument));
        if (match?.[1] === undefined) return false;
        state.alpha = Number.parseInt(match[1], 16) / 255;
        return true;
      }
      case 'b':
        state.bold++;
        return true;
      case 'i':
        state.italic++;
        return true;
      case 'u':
        state.underline++;
        return true;
      case 's':
      case 'strikethrough':
        state.strikethrough++;
        return true;
      case 'mark': {
        const color = parseColor(argument === '' ? '#ffff0040' : argument);
        if (color === null) return false;
        const alpha = color.alpha ?? 1;
        const channels = [1, 3, 5].map((offset) => Number.parseInt(color.rgb.slice(offset, offset + 2), 16));
        state.marks.push(`rgba(${channels.join(',')},${String(alpha)})`);
        return true;
      }
      case 'sup':
      case 'sub': {
        const current = state.scripts.at(-1) ?? { scale: 1, offset: 0 };
        const scale = current.scale * 0.5;
        state.scripts.push({
          scale,
          offset: current.offset + (name === 'sup' ? 0.35 : -0.15) * (state.sizes.at(-1) ?? 1),
        });
        return true;
      }
      case 'voffset': {
        const amount = parseUnitValue(argument);
        if (amount === null) return false;
        state.voffset.push(toBase(amount, state.sizes.at(-1) ?? 1));
        return true;
      }
      case 'cspace': {
        const amount = parseUnitValue(argument);
        if (amount === null) return false;
        state.cspace.push(toBase(amount, state.sizes.at(-1) ?? 1));
        return true;
      }
      case 'mspace': {
        const amount = parseUnitValue(argument);
        if (amount === null) return false;
        state.mspace.push(toBase(amount, state.sizes.at(-1) ?? 1));
        return true;
      }
      case 'space': {
        const amount = parseUnitValue(argument);
        if (amount === null) return false;
        if (!lineHasContent) {
          line.align = state.align.at(-1) ?? 'center';
          lineHasContent = true;
        }
        pushRun('', size(), toBase(amount, state.sizes.at(-1) ?? 1));
        return true;
      }
      case 'rotate': {
        const degrees = Number(unquote(argument));
        if (!Number.isFinite(degrees)) return false;
        state.rotation.push(degrees);
        return true;
      }
      case 'line-height': {
        const amount = parseUnitValue(argument);
        if (amount === null) return false;
        state.lineHeight = toBase(amount, state.sizes.at(-1) ?? 1);
        if (!lineHasContent) line.lineHeight = state.lineHeight;
        return true;
      }
      case 'align': {
        const align = unquote(argument).toLowerCase();
        const mapped: RichTextAlign | undefined =
          align === 'left' || align === 'right' || align === 'center'
            ? align
            : align === 'justified' || align === 'flush'
              ? 'left'
              : undefined;
        if (mapped === undefined) return false;
        state.align.push(mapped);
        if (!lineHasContent) line.align = mapped;
        return true;
      }
      case 'uppercase':
      case 'allcaps':
        state.textCase.push('upper');
        return true;
      case 'lowercase':
        state.textCase.push('lower');
        return true;
      case 'smallcaps':
        state.textCase.push('smallcaps');
        return true;
      case 'br':
        appendText('\n');
        return true;
      default:
        return ignoredTags.has(name);
    }
  }

  startLine();
  let offset = 0;
  let pending = '';
  while (offset < value.length) {
    const open = value.indexOf('<', offset);
    if (open === -1) {
      pending += value.slice(offset);
      break;
    }
    pending += value.slice(offset, open);
    const close = value.indexOf('>', open + 1);
    const nested = value.indexOf('<', open + 1);
    if (close === -1 || (nested !== -1 && nested < close) || close - open - 1 > maxTagLength) {
      pending += '<';
      offset = open + 1;
      continue;
    }
    const tag = value.slice(open + 1, close);
    if (/^noparse$/i.test(tag.trim())) {
      const end = value.toLowerCase().indexOf('</noparse>', close + 1);
      pending += value.slice(close + 1, end === -1 ? value.length : end);
      offset = end === -1 ? value.length : end + '</noparse>'.length;
      continue;
    }
    // Text before a tag takes the style that was active before it.
    if (pending !== '') {
      appendText(pending);
      pending = '';
    }
    if (applyTag(tag)) {
      offset = close + 1;
    } else {
      pending += '<';
      offset = open + 1;
    }
  }
  if (pending !== '') appendText(pending);
  lines.push(line);
  return { lines, plain };
}
