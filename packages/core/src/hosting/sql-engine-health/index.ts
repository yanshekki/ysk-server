export * from './types.js';
export * from './diagnose.js';
export * from './execute.js';

/** Backward-compatible alias used by older call sites */
export { executeSqlEngineRepair as recoverMysqlAfterEngineSwitch } from './compat.js';
export { unfreezeViaHealth as unfreezeMysqlEngine } from './compat.js';
