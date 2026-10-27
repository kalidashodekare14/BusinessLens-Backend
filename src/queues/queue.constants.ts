/**
 * Queue and job names are shared between the API (producers) and the worker
 * (consumers), so they live in one place. Renaming a queue drops its Redis
 * backlog, and in-flight jobs are lost; treat these strings as stable.
 */
export const QUEUE_NAMES = {
  importProcessing: 'import-processing',
  analysis: 'analysis',
  aiExplanation: 'ai-explanation',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  processImport: 'process-import',
  runAnalysis: 'run-analysis',
  generateExplanation: 'generate-explanation',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
