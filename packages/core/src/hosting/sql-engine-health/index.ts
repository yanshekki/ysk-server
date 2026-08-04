export * from './types.js';
export * from './diagnose.js';
export * from './execute.js';

/** Compat helpers (distinct names — switch module already owns recover/unfreeze aliases). */
export {
  executeSqlEngineRepairAsRecover,
  unfreezeViaHealth,
} from './compat.js';
