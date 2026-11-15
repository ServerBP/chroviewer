const ascii = (text: string) => new TextEncoder().encode(text);
const oggCapture = ascii('OggS');
const vorbisIdentification = ascii('\x01vorbis');
const opusHead = ascii('OpusHead');
const riff = ascii('RIFF');
const wave = ascii('WAVE');
const fmtChunk = ascii('fmt ');
const dataChunk = ascii('data');
const opusSampleRate = 48_000;

function matchesAt(bytes: Uint8Array, offset: number, signature: Uint8Array) {
  if (offset < 0 || offset + signature.length > bytes.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function oggDuration(bytes: Uint8Array, view: DataView) {
  if (bytes.length < 28 || !matchesAt(bytes, 0, oggCapture)) return null;
  const serial = view.getUint32(14, true);
  const segments = bytes[26] ?? 0;
  const packet = 27 + segments;
  let sampleRate: number;
  let preSkip = 0;
  if (matchesAt(bytes, packet, vorbisIdentification) && packet + 16 <= bytes.length) {
    sampleRate = view.getUint32(packet + 12, true);
  } else if (matchesAt(bytes, packet, opusHead) && packet + 12 <= bytes.length) {
    preSkip = view.getUint16(packet + 10, true);
    sampleRate = opusSampleRate;
  } else {
    return null;
  }
  if (sampleRate <= 0) return null;

  // The last page of the stream carries the total sample count as its granule position.
  for (let offset = bytes.length - 27; offset >= 0; offset--) {
    if (!matchesAt(bytes, offset, oggCapture) || view.getUint32(offset + 14, true) !== serial) continue;
    const granule = view.getBigUint64(offset + 6, true);
    if (granule === 0xffff_ffff_ffff_ffffn) continue;
    const samples = Number(granule) - preSkip;
    return samples > 0 ? samples / sampleRate : null;
  }
  return null;
}

function wavDuration(bytes: Uint8Array, view: DataView) {
  if (bytes.length < 12 || !matchesAt(bytes, 0, riff) || !matchesAt(bytes, 8, wave)) return null;
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const size = view.getUint32(offset + 4, true);
    if (matchesAt(bytes, offset, fmtChunk) && offset + 20 <= bytes.length) {
      byteRate = view.getUint32(offset + 16, true);
    } else if (matchesAt(bytes, offset, dataChunk)) {
      const dataSize = Math.min(size, bytes.length - offset - 8);
      return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** The song's length from its container headers, without decoding it. Null for formats it cannot read. */
export function audioDurationSeconds(audioData: ArrayBuffer | null | undefined) {
  if (audioData === null || audioData === undefined) return null;
  const bytes = new Uint8Array(audioData);
  const view = new DataView(audioData);
  const duration = oggDuration(bytes, view) ?? wavDuration(bytes, view);
  return duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null;
}
