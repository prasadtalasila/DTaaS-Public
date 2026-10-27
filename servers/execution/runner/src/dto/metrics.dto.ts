import type { CommandStateStatus } from './state.dto.js';

// The commands received since the runner started, by status
export type CommandCounts = Record<CommandStateStatus, number>;
