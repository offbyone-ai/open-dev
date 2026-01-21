export { DiffView, SplitDiffView, DiffStats } from "./diff-view";
export {
  MultiFileDiffPreview,
  type FileChange,
  type FileChangeOperation,
} from "./multi-file-diff-preview";
export {
  computeDiff,
  createHunks,
  computeDiffStats,
  getFileExtension,
  getLanguageFromExtension,
  applyEditAndComputeDiff,
  type DiffLine,
  type FileDiff,
  type DiffHunk,
} from "../../lib/diff";
