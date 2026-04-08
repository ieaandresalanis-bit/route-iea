# Leads (Prospectos)

## Purpose

Core CRM entity management. Create, view, filter, update, and convert leads. Also provides geographic map visualization for territory planning.

## Pages

| Route | Name | Description |
|-------|------|-------------|
| `/leads` | Prospectos | Lead table with filters |
| `/leads/map` | Mapa Prospectos | Map view with zone-colored markers |

## What it shows

### Lead List (`/leads`)
- Filterable table with 11 status tabs + zone dropdown + keyword search
- Columns: company name, contact, status, zone, value, last contact, assigned advisor
- Actions: view detail, edit, convert to client

### Lead Map (`/leads/map`)
- Google Maps with all leads plotted as markers
- Color-coded by zone
- Lightweight data optimized for map rendering

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/leads` | Create lead |
| GET | `/api/leads` | List with filters (status, zone, search, page, limit) |
| GET | `/api/leads/stats` | Count by zone and status |
| GET | `/api/leads/map` | Minimal lat/lng data for markers |
| GET | `/api/leads/commercial-map` | Enriched data for commercial map |
| GET | `/api/leads/:id` | Lead detail with visit history |
| PATCH | `/api/leads/:id` | Update lead fields |
| PATCH | `/api/leads/:id/convert` | Convert to client (CERRADO_GANADO) |
| DELETE | `/api/leads/:id` | Soft delete |

## Data Used

- **Lead model:** companyName, contactName, contactEmail, contactPhone, latitude, longitude, address, zone, status, source, industry, estimatedValue, assignedToId, Zoho sync fields
- **Visit model:** linked for history display

## Business Logic

- Leads flow through 12 statuses from PENDIENTE_CONTACTAR to CERRADO_GANADO/CERRADO_PERDIDO
- Terminal statuses: CERRADO_GANADO, CERRADO_PERDIDO, LEAD_BASURA, CONTACTAR_FUTURO
- Soft delete sets `deletedAt` timestamp; records are never physically deleted
- `lastContactedAt` updated automatically when visits are logged

## Who uses it

- **Advisors:** Daily lead management
- **Supervisors:** Monitor lead distribution and status
- **Director:** Territory planning via map

## Current Status: Complete
