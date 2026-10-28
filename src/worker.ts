import 'reflect-metadata';
import { loadConfigOrExit } from './config/configuration';

// The worker has no DI container until TASKS.md T3.1, so it validates env directly.
// Requires .env to be loaded by the caller: `start:worker` passes --env-file-if-exists.
loadConfigOrExit(process.env);

// The BullMQ processors are registered in TASKS.md T3.1. Until then this entry point
// exists so the `start:worker` script has a real target and builds with the API.
console.log('[worker] no processors registered yet (TASKS.md T3.1)');
