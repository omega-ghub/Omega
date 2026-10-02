// The mounted timeline controller, for code outside the canvas (menus,
// inline editors, actions) that needs screen geometry. Null when no timeline
// is mounted.

export interface TimelineHandle {
  /** Client rect of a clip as currently drawn, or null when off-screen. */
  clipClientRect(clipId: string): DOMRect | null;
  /** Client x of a timeline time. */
  timeToClientX(t: number): number;
  invalidate(): void;
}

export const ctlRef: { current: TimelineHandle | null } = { current: null };
