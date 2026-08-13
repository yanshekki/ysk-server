export { filesApi, fileToBase64, type FileEntry } from './api';
export {
  collectFromDataTransfer,
  collectFromFileList,
  type CollectedUpload,
} from './drop-collect';
export { FileNameConflictDialog } from './FileNameConflictDialog';
export {
  groupCollectedUploads,
  isNameConflictError,
  planCollectedUploads,
  type ConflictDecision,
  type FileNameConflictPrompt,
  type PlannedUpload,
} from './name-conflict';
export { useFiles } from './useFiles';
