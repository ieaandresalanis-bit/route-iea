# IEA Growth Intelligence

Commercial Intelligence & Growth System for **Ingenieria Electrica Alanis** (Guadalajara, Jalisco).

## Features

- JWT authentication with role-based access (Admin, Supervisor, Operator, Viewer)
- Vehicle fleet CRUD with status tracking
- Trip planning, start/complete/cancel lifecycle
- Real-time GPS tracking via WebSocket (Socket.IO)
- Fuel consumption logging with efficiency calculations
- Odometer tracking with validation
- Dashboard with fleet KPIs
- Swagger API documentation
- PostgreSQL + PostGIS, Prisma ORM

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** NestJS 10
- **Database:** PostgreSQL 15 + PostGIS
- **ORM:** Prisma
- **Auth:** Passport JWT
- **WebSocket:** Socket.IO
- **Docs:** Swagger/OpenAPI

## Quick Start

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL)

### 1. Start the database

```bash
docker-compose up -d postgres
```

### 2. Install dependencies

```bash
cd backend
npm install
```

### 3. Configure environment

```bash
cp ../.env.example .env
```

Edit `.env` if needed. Defaults work for local development.

### 4. Run migrations and seed

```bash
npx prisma migrate dev --name init
npm run prisma:seed
```

### 5. Start the server

```bash
npm run start:dev
```

### 6. Open in browser

- **API:** http://localhost:3000/api
- **Swagger Docs:** http://localhost:3000/api/docs
- **Health Check:** http://localhost:3000/health

## Default Credentials

```
Email:    admin@iea.com
Password: Admin123!
```

## API Endpoints

| Method | Endpoint                           | Description                  |
|--------|------------------------------------|------------------------------|
| POST   | /api/auth/login                    | Login, get JWT token         |
| POST   | /api/auth/register                 | Register new user            |
| GET    | /api/auth/profile                  | Current user profile         |
| GET    | /api/users                         | List users                   |
| GET    | /api/vehicles                      | List vehicles                |
| POST   | /api/vehicles                      | Create vehicle               |
| GET    | /api/vehicles/summary              | Fleet summary                |
| GET    | /api/trips                         | List trips                   |
| POST   | /api/trips                         | Create trip                  |
| PATCH  | /api/trips/:id/start               | Start trip                   |
| PATCH  | /api/trips/:id/complete            | Complete trip                |
| POST   | /api/gps/position                  | Record GPS position          |
| GET    | /api/gps/fleet                     | All vehicles latest position |
| GET    | /api/gps/vehicle/:id/history       | GPS history                  |
| POST   | /api/fuel                          | Record fuel fill-up          |
| GET    | /api/fuel/vehicle/:id/efficiency   | Fuel efficiency (km/L)       |
| POST   | /api/odometer                      | Record odometer reading      |
| GET    | /api/dashboard/overview            | Dashboard KPIs               |

## WebSocket (GPS Tracking)

Connect to `ws://localhost:3000/tracking` with Socket.IO:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/tracking');

// Subscribe to a vehicle's live feed
socket.emit('gps:subscribe', { vehicleId: 'uuid-here' });

// Listen for position updates
socket.on('gps:update', (data) => {
  console.log('New position:', data.latitude, data.longitude);
});

// Send a GPS position
socket.emit('gps:position', {
  vehicleId: 'uuid-here',
  latitude: 20.6636914,
  longitude: -103.2343897,
  speed: 45,
});
```

## Project Structure

```
route-iea/
├── backend/
│   ├── src/
│   │   ├── main.ts                  # App bootstrap
│   │   ├── app.module.ts            # Root module
│   │   ├── config/                  # Environment config
│   │   ├── database/                # Prisma service
│   │   ├── common/                  # Shared decorators, filters, pipes
│   │   ├── auth/                    # JWT auth, login, register
│   │   ├── users/                   # User management
│   │   ├── vehicles/                # Vehicle fleet
│   │   ├── trips/                   # Trip lifecycle
│   │   ├── gps/                     # GPS tracking + WebSocket
│   │   ├── fuel/                    # Fuel logs
│   │   ├── odometer/                # Odometer logs
│   │   ├── dashboard/               # KPIs and activity
│   │   └── health/                  # Health check
│   ├── prisma/
│   │   ├── schema.prisma            # Database schema
│   │   └── seed.ts                  # Sample data
│   ├── test/
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
├── Makefile
└── README.md
```
