import { describe, expect, test } from 'vite-plus/test';

import { audioDurationSeconds } from './audio-duration';

function oggPage(granule: bigint, serial: number, packet: number[]) {
  const page = new Uint8Array(28 + packet.length);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53]);
  view.setBigUint64(6, granule, true);
  view.setUint32(14, serial, true);
  page[26] = 1;
  page[27] = packet.length;
  page.set(packet, 28);
  return page;
}

function concat(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes.buffer;
}

const text = (value: string) => Array.from(new TextEncoder().encode(value));
const uint32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];

describe('audio duration from container headers', () => {
  test('reads an Ogg Vorbis song length from its last page', () => {
    const identification = [0x01, ...text('vorbis'), ...uint32(0), 2, ...uint32(44_100), ...uint32(0)];
    const audio = concat(
      oggPage(0n, 7, identification),
      oggPage(441_000n, 7, [1, 2, 3]),
      oggPage(0xffff_ffff_ffff_ffffn, 7, [4]),
      oggPage(5_292_000n, 7, [5, 6]),
      oggPage(999_999_999n, 8, [9]),
    );
    expect(audioDurationSeconds(audio)).toBeCloseTo(120, 6);
  });

  test('removes the Opus pre-skip and counts at 48 kHz', () => {
    const head = [...text('OpusHead'), 1, 2, 0x38, 0x01, ...uint32(44_100), 0, 0, 0];
    const audio = concat(oggPage(0n, 3, head), oggPage(4_800_312n, 3, [1]));
    expect(audioDurationSeconds(audio)).toBeCloseTo(100, 6);
  });

  test('reads a WAV song length from its data chunk', () => {
    const fmt = [...text('fmt '), ...uint32(16), 1, 0, 2, 0, ...uint32(48_000), ...uint32(192_000), 4, 0, 16, 0];
    const data = [...text('data'), ...uint32(384_000)];
    const header = new Uint8Array([...text('RIFF'), ...uint32(0), ...text('WAVE'), ...fmt, ...data]);
    expect(audioDurationSeconds(concat(header, new Uint8Array(384_000)))).toBeCloseTo(2, 6);
  });

  test('returns null for missing or unknown audio', () => {
    expect(audioDurationSeconds(null)).toBeNull();
    expect(audioDurationSeconds(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
    expect(audioDurationSeconds(concat(oggPage(0n, 1, text('unknown')), oggPage(48_000n, 1, [1])))).toBeNull();
  });
});
