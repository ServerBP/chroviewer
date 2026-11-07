import { generateProtocol } from './generate-protocol.ts';

// tarf.proto is a copy of TARF/tarf.proto from TournamentAssistant.
await generateProtocol({
  name: 'TARF protocol',
  protoRoot: 'src/core/replay/proto',
  generatedRoot: 'src/core/replay/generated/proto',
  packagePath: 'tarf/v1',
});
