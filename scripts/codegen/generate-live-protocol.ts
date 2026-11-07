import { generateProtocol } from './generate-protocol.ts';

await generateProtocol({
  name: 'live protocol',
  protoRoot: 'src/modules/live/proto',
  generatedRoot: 'src/modules/live/generated/proto',
  packagePath: 'scoresaber/live/v1',
});
