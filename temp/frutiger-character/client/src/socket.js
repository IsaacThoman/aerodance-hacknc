import { io } from 'socket.io-client';

// Same origin in production (Express serves the client); proxied by Vite in dev.
export const socket = io();
