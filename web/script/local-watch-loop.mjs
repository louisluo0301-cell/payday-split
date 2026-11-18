import { setTimeout } from 'node:timers/promises';
import { createLocalRelay } from './local-relay.mjs';

const relay = await createLocalRelay();
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
console.log('[local-watch] watching', relay.assets.join(', '));
try {
  while (!stop.signal.aborted) {
    try {
      const { callbacks } = await relay.tick();
      if (callbacks) console.log(`[local-watch] delivered ${callbacks} waterfall callbacks`);
    } catch (error) {
      console.error('[local-watch]', error.shortMessage || error.message);
    }
    await setTimeout(1500, undefined, { signal: stop.signal });
  }
} catch (error) {
  if (error.name !== 'AbortError') throw error;
} finally {
  relay.close();
}
