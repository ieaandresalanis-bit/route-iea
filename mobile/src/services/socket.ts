import { io, Socket } from 'socket.io-client';
import { CONFIG } from '../constants/config';

let socket: Socket | null = null;

/** Get or create the Socket.IO connection for GPS tracking */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${CONFIG.WS_URL}/tracking`, {
      transports: ['websocket'],
      autoConnect: true,
    });
  }
  return socket;
}

/** Disconnect and clean up */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
