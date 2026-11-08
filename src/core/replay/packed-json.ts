// Packed JSON, how TARF replays store the JSON files of their map. The values
// of one key from every object in a list are stored together, see "Map files"
// in TARF/README.md in the TournamentAssistant repository.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const kinds = { number: 0, string: 1, list: 2, object: 3, literal: 4, mixed: 5 };
const forms = { fraction: 0, float: 1, double: 2 };
const layouts = { positional: 0, flat: 1 };
const literals = [null, false, true] as const;

// A corrupted count shouldn't make the reader allocate billions of values.
const maxValues = 64 * 1024 * 1024;

// Varints up to this many bytes fit a double exactly.
const exactVarintBytes = 7;

export function unpackJson(data: Uint8Array): JsonValue {
  const reader = new Reader(data);
  const [root] = reader.root();
  if (root === undefined || !reader.done()) throw new Error('packed JSON has data after its last value');
  return root;
}

function setKey(row: Record<string, JsonValue>, key: string, value: JsonValue) {
  // Assigning __proto__ would change the prototype instead of adding the key.
  if (key === '__proto__')
    Object.defineProperty(row, key, { value, writable: true, enumerable: true, configurable: true });
  else row[key] = value;
}

class Reader {
  private offset = 0;
  private valueCount = 0;
  private readonly view: DataView;
  private readonly strings: string[] = [];

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  root() {
    const decoder = new TextDecoder();
    const stringCount = this.count();
    for (let i = 0; i < stringCount; i++) this.strings.push(decoder.decode(this.bytes(this.count())));
    return this.column(1);
  }

  done() {
    return this.offset === this.data.byteLength;
  }

  private byte() {
    const byte = this.data[this.offset++];
    if (byte === undefined) throw new Error('packed JSON is truncated');
    return byte;
  }

  private bytes(length: number) {
    if (length > this.data.byteLength - this.offset) throw new Error('packed JSON is truncated');
    const bytes = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  private count() {
    let value = 0;
    let multiplier = 1;
    for (let length = 0; length < 5; length++) {
      const byte = this.byte();
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return value;
      multiplier *= 0x80;
    }
    throw new Error('packed JSON count is too large');
  }

  // Reads a ZigZag varint and adds it to base. Longer varints may not fit a
  // double exactly, so those are added up as BigInts.
  private signed(base: number) {
    const start = this.offset;
    let value = 0;
    let multiplier = 1;
    for (let length = 0; length < exactVarintBytes; length++) {
      const byte = this.byte();
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return base + (value % 2 === 0 ? value / 2 : -(value + 1) / 2);
      multiplier *= 0x80;
    }

    this.offset = start;
    let zigZag = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (shift > 63n) throw new Error('packed JSON varint is too long');
      const byte = this.byte();
      zigZag |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
    }
    return Number(BigInt(base) + ((zigZag >> 1n) ^ -(zigZag & 1n)));
  }

  private string() {
    const value = this.strings[this.count()];
    if (value === undefined) throw new Error('packed JSON string index is out of range');
    return value;
  }

  private integers(count: number) {
    const delta = this.byte() === 1;
    let previous = 0;
    return Array.from({ length: count }, () => (previous = this.signed(delta ? previous : 0)));
  }

  private column(count: number): JsonValue[] {
    this.valueCount += count;
    if (this.valueCount > maxValues) throw new Error('packed JSON has too many values');

    const kind = this.byte();
    if (kind === kinds.number) return this.numbers(count);
    if (kind === kinds.string) return Array.from({ length: count }, () => this.string());
    if (kind === kinds.list) return this.lists(count);
    if (kind === kinds.object) return this.objects(count);
    if (kind === kinds.literal) {
      return Array.from(this.bytes(count), (literal) => {
        const value = literals[literal];
        if (value === undefined) throw new Error(`unknown packed JSON literal ${literal}`);
        return value;
      });
    }
    if (kind !== kinds.mixed) throw new Error(`unknown packed JSON kind ${kind}`);

    const valueKinds = this.bytes(count).slice();
    const parts: JsonValue[][] = [];
    for (let part = 0; part < kinds.mixed; part++) {
      const partCount = valueKinds.reduce((total, valueKind) => total + (valueKind === part ? 1 : 0), 0);
      if (partCount > 0) parts[part] = this.column(partCount).reverse();
    }
    return Array.from(valueKinds, (valueKind) => {
      const value = parts[valueKind]?.pop();
      if (value === undefined) throw new Error(`unknown packed JSON kind ${valueKind}`);
      return value;
    });
  }

  private numbers(count: number) {
    const denominator = this.count();
    if (denominator === 0) throw new Error('packed JSON denominator is 0');

    const valueForms = this.byte() === 1 ? this.bytes(count).slice() : new Uint8Array(count);
    let fractionCount = 0;
    let floatCount = 0;
    let doubleCount = 0;
    for (const form of valueForms) {
      if (form === forms.fraction) fractionCount++;
      else if (form === forms.float) floatCount++;
      else if (form === forms.double) doubleCount++;
      else throw new Error(`unknown packed JSON number form ${form}`);
    }

    const numerators = this.integers(fractionCount);
    const floatOffset = this.offset;
    this.bytes(4 * floatCount);
    const doubleOffset = this.offset;
    this.bytes(8 * doubleCount);

    let nextNumerator = 0;
    let nextFloat = floatOffset;
    let nextDouble = doubleOffset;
    return Array.from(valueForms, (form) => {
      if (form === forms.fraction) {
        const numerator = numerators[nextNumerator++] ?? 0;
        // Whole numbers are exact, everything else is the float Beat Saber reads.
        return numerator % denominator === 0 ? numerator / denominator : Math.fround(numerator / denominator);
      }
      if (form === forms.float) {
        const value = this.view.getFloat32(nextFloat, true);
        nextFloat += 4;
        return value;
      }
      const value = this.view.getFloat64(nextDouble, true);
      nextDouble += 8;
      return value;
    });
  }

  private lists(count: number) {
    const lengths = this.integers(count);
    const lists = lengths.map((length) => {
      if (length < 0 || length > maxValues) throw new Error('packed JSON list length is out of range');
      return [] as JsonValue[];
    });
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (total === 0) return lists;

    const layout = this.byte();
    if (layout === layouts.flat) {
      const items = this.column(total);
      let next = 0;
      lists.forEach((list, i) => {
        for (let j = 0; j < (lengths[i] ?? 0); j++) list.push(items[next++] ?? null);
      });
    } else if (layout === layouts.positional) {
      const longest = lengths.reduce((most, length) => Math.max(most, length), 0);
      for (let position = 0; position < longest; position++) {
        const targets = lists.filter((_, i) => (lengths[i] ?? 0) > position);
        this.column(targets.length).forEach((item, i) => targets[i]?.push(item));
      }
    } else {
      throw new Error(`unknown packed JSON list layout ${layout}`);
    }
    return lists;
  }

  private objects(count: number) {
    const rows = Array.from({ length: count }, () => ({}) as Record<string, JsonValue>);

    // Grouped rows are stored in the order of their group value, rows with the
    // same value keep their original order.
    let stored = rows;
    if (this.byte() === 1) {
      const groupKey = this.string();
      const grouped = this.column(count).map((group, i) => {
        if (typeof group !== 'number') throw new Error('packed JSON group value is not a number');
        const row = rows[i] ?? {};
        setKey(row, groupKey, group);
        return { group, row };
      });
      stored = grouped.sort((left, right) => left.group - right.group).map(({ row }) => row);
    }

    const keyCount = this.count();
    for (let k = 0; k < keyCount; k++) {
      const key = this.string();
      let present = stored;
      if (this.byte() === 1) {
        const bitmap = this.bytes(Math.ceil(count / 8));
        present = stored.filter((_, i) => (((bitmap[i >> 3] ?? 0) >> (i & 7)) & 1) === 1);
      }
      this.column(present.length).forEach((value, i) => {
        const row = present[i];
        if (row !== undefined) setKey(row, key, value);
      });
    }
    return rows;
  }
}
