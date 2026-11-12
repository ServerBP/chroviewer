import { Result } from 'better-result';

import { anticheatFileKind, parseAnticheatFile } from '../../replay/anticheat';
import { isBeatLeaderReplay, parseBeatLeaderReplay } from '../../replay/parse-beatleader';
import { parseScoreSaberReplay } from '../../replay/parse-scoresaber';
import { isTarfReplay, parseTarfReplay } from '../../replay/parse-tarf';
import { parseInfo } from '../info';
import { parseDifficulty } from '../parse';
import type { WorkerRequest, WorkerResponse, WorkerSuccess } from './protocol';

async function execute(request: WorkerRequest): Promise<WorkerSuccess> {
  if (request.kind === 'info') {
    return { id: request.id, ok: true, kind: request.kind, result: parseInfo(request.text) };
  }
  if (request.kind === 'replay') {
    const bytes = new Uint8Array(request.data);
    if (anticheatFileKind(bytes) !== null) {
      // The first replay is the one played back; a comparison carries the others along for their sabers
      const file = parseAnticheatFile(bytes);
      const [first, ...rest] = file.replays.map((tarf) => parseTarfReplay(tarf));
      if (first === undefined) throw new Error('anticheat file holds no replay');
      first.anticheat =
        file.document.kind === 'comparison'
          ? { kind: 'comparison', comparison: file.document, others: rest }
          : { kind: 'report', report: file.document };
      return { id: request.id, ok: true, kind: request.kind, result: first };
    }
    const replay = isTarfReplay(bytes)
      ? parseTarfReplay(bytes)
      : isBeatLeaderReplay(bytes)
        ? parseBeatLeaderReplay(bytes)
        : await parseScoreSaberReplay(bytes);
    return {
      id: request.id,
      ok: true,
      kind: request.kind,
      result: replay,
    };
  }
  return {
    id: request.id,
    ok: true,
    kind: request.kind,
    result: parseDifficulty(request.text, request.songBpm, {
      lightshowText: request.lightshowText,
      audioDataText: request.audioDataText,
      bookmarkText: request.bookmarkText,
    }),
  };
}

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  const response = await Result.tryPromise({
    try: () => execute(request),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  return response.isOk() ? response.value : { id: request.id, ok: false, error: response.error.message };
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data).then((response) => {
    self.postMessage(response);
  });
});
