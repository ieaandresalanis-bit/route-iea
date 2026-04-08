import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GpsService } from './gps.service';
import { GpsPositionDto } from './dto/gps-position.dto';

/**
 * WebSocket gateway for real-time GPS tracking.
 *
 * Events:
 *   Client -> Server:
 *     "gps:position"   — send a new GPS position
 *     "gps:subscribe"  — subscribe to a vehicle's live feed
 *     "gps:unsubscribe"— unsubscribe from a vehicle
 *
 *   Server -> Client:
 *     "gps:update"     — broadcast new position to subscribers
 *     "gps:fleet"      — broadcast latest fleet positions
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/tracking',
})
export class GpsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GpsGateway.name);

  constructor(private gpsService: GpsService) {}

  afterInit(): void {
    this.logger.log('GPS WebSocket gateway initialized');
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Receive a GPS position from a device / mobile app.
   * Stores it in the database and broadcasts to subscribers.
   */
  @SubscribeMessage('gps:position')
  async handlePosition(
    @MessageBody() data: GpsPositionDto,
    @ConnectedSocket() client: Socket,
  ) {
    const log = await this.gpsService.recordPosition(data);

    // Broadcast to all clients watching this specific vehicle
    this.server.to(`vehicle:${data.vehicleId}`).emit('gps:update', {
      vehicleId: data.vehicleId,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed,
      heading: data.heading,
      engineOn: data.engineOn,
      recordedAt: log.recordedAt,
    });

    return { success: true, id: log.id };
  }

  /** Client subscribes to live updates for a specific vehicle */
  @SubscribeMessage('gps:subscribe')
  handleSubscribe(
    @MessageBody() data: { vehicleId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`vehicle:${data.vehicleId}`);
    this.logger.debug(`${client.id} subscribed to vehicle:${data.vehicleId}`);
    return { subscribed: data.vehicleId };
  }

  /** Client unsubscribes from a vehicle feed */
  @SubscribeMessage('gps:unsubscribe')
  handleUnsubscribe(
    @MessageBody() data: { vehicleId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`vehicle:${data.vehicleId}`);
    return { unsubscribed: data.vehicleId };
  }

  /**
   * Broadcast the full fleet's latest positions to all connected clients.
   * Called periodically by the GpsController or a scheduled task.
   */
  async broadcastFleetPositions() {
    const positions = await this.gpsService.getLatestPositions();
    this.server.emit('gps:fleet', positions);
  }
}
