import type { Player } from '../../engine/player';

// The Monitor owns the Player; shortcuts and transport buttons reach it here.
export const playerHost: { current: Player | null } = { current: null };
