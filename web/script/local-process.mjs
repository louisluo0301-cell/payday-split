import { createLocalRelay } from './local-relay.mjs';

const relay = await createLocalRelay();
try {
  const { events, callbacks } = await relay.tick();
  console.log(`Processed ${events} rule and transfer logs; delivered ${callbacks} callbacks.`);
} finally {
  relay.close();
}
