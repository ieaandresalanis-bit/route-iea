import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, TravelMode } from '@googlemaps/google-maps-services-js';

export interface OptimizeRouteParams {
  origin: { lat: number; lng: number };
  destination?: { lat: number; lng: number }; // defaults to origin (round trip)
  waypoints: Array<{ lat: number; lng: number }>;
  optimizeWaypoints?: boolean;
}

export interface OptimizeRouteResult {
  polyline: string;
  totalDistanceKm: number;
  totalDurationMins: number;
  waypointOrder: number[];
  legs: Array<{
    distanceKm: number;
    durationMins: number;
    startAddress: string;
    endAddress: string;
  }>;
}

@Injectable()
export class GoogleDirectionsService {
  private readonly logger = new Logger(GoogleDirectionsService.name);
  private readonly client: Client;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.client = new Client({});
    this.apiKey = this.configService.get<string>('googleMaps.apiKey', '');
  }

  async optimizeRoute(params: OptimizeRouteParams): Promise<OptimizeRouteResult> {
    const { origin, waypoints, optimizeWaypoints = true } = params;
    const destination = params.destination ?? origin; // round trip by default

    this.logger.log(`Optimizing route: ${waypoints.length} waypoints`);

    const response = await this.client.directions({
      params: {
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        waypoints: waypoints.map((wp) => `${wp.lat},${wp.lng}`),
        optimize: optimizeWaypoints,
        mode: TravelMode.driving,
        key: this.apiKey,
      },
    });

    const route = response.data.routes[0];
    if (!route) {
      throw new Error('No route found by Google Directions API');
    }

    const legs = route.legs.map((leg) => ({
      distanceKm: (leg.distance?.value ?? 0) / 1000,
      durationMins: (leg.duration?.value ?? 0) / 60,
      startAddress: leg.start_address ?? '',
      endAddress: leg.end_address ?? '',
    }));

    const totalDistanceKm = legs.reduce((sum, l) => sum + l.distanceKm, 0);
    const totalDurationMins = legs.reduce((sum, l) => sum + l.durationMins, 0);

    this.logger.log(
      `Route optimized: ${totalDistanceKm.toFixed(1)} km, ${totalDurationMins.toFixed(0)} mins`,
    );

    return {
      polyline: route.overview_polyline?.points ?? '',
      totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
      totalDurationMins: Math.round(totalDurationMins * 100) / 100,
      waypointOrder: route.waypoint_order ?? [],
      legs,
    };
  }
}
