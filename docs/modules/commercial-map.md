# Commercial Map (Mapa Comercial)

## Purpose

Geographic intelligence layer. Visualizes leads, pipeline, and opportunities on a map for territory planning, advisor routing, and market analysis.

## Page

**Route:** `/sales/map`
**Sidebar:** Mapa Comercial

## What it shows

- **6 Map Layers:**
  1. Leads by Zone (color-coded)
  2. Hot Leads (Priority Engine top scores)
  3. Pipeline (active deals by stage)
  4. Clients (closed won)
  5. Low Attention (leads without recent contact)
  6. Lost Leads (closed lost)

- **Side Panel (3 tabs):**
  1. Zones: Zone summary cards with lead count and pipeline value
  2. Cities: City-level breakdown
  3. Filters: Advisor, industry, value range, status filters

- **Map Features:**
  - Google Maps integration
  - Zone-colored markers
  - Info windows with lead details
  - Cluster markers for dense areas

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/leads/commercial-map` | Enriched lead data for map |

## Who uses it

- **Director:** Territory strategy and market analysis
- **Supervisors:** Advisor territory assignment
- **Advisors:** Route planning for field visits

## Current Status: Complete
