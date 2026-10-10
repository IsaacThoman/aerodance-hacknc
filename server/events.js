import { EventEmitter } from 'node:events';

// In-process change feed: 'battle' (id), 'profile' (id), 'hype' ({ battleId, seat, from }).
// index.js forwards these to Socket.IO rooms; the agent's changes arrive via LISTEN 'changes'.
export const changes = new EventEmitter();
