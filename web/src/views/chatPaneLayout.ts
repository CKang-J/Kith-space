export const MIN_THREAD_WIDTH = 260;
export const MIN_CONVERSATION_WIDTH = 360;
export const THREAD_DIVIDER_WIDTH = 10;

export interface ThreadPaneConstraints {
  min: number;
  max: number;
  width: number;
}

export function defaultThreadPaneWidth(surfaceWidth: number): number {
  return Math.max(0, (surfaceWidth - THREAD_DIVIDER_WIDTH) / 2);
}

export function threadPaneConstraints(surfaceWidth: number, requestedWidth: number): ThreadPaneConstraints {
  const max = Math.max(0, surfaceWidth - MIN_CONVERSATION_WIDTH - THREAD_DIVIDER_WIDTH);
  const min = Math.min(MIN_THREAD_WIDTH, max);
  return {
    min,
    max,
    width: Math.min(max, Math.max(min, requestedWidth)),
  };
}
