# Strategy / Commercial Planning (Planeacion Comercial)

## Purpose

Strategic planning module with data-driven insights across 7 dimensions: target prospects, zones, ticket sizes, industries, campaigns, segments, and work centers.

## Page

**Route:** `/sales/strategy`
**Sidebar:** Planeacion Comercial

## What it shows

### 7 Tabs

1. **Targets:** High-value leads requiring strategic attention, ranked by potential
2. **Zones:** Zone priority analysis with lead count, pipeline value, conversion rate, and opportunity score
3. **Tickets:** Deal analysis by ticket range (micro <$50K, small $50-150K, medium $150-500K, large $500K-1.5M, enterprise >$1.5M)
4. **Industries:** Conversion metrics by industry vertical
5. **Campaigns:** Campaign effectiveness recommendations
6. **Segments:** Messaging strategy per market segment
7. **Centers:** Per-center commercial plans

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/planner/targets` | Target priorities |
| GET | `/api/planner/zones` | Zone priorities |
| GET | `/api/planner/tickets` | Ticket analysis |
| GET | `/api/planner/industries` | Industry conversions |
| GET | `/api/planner/campaigns` | Campaign recommendations |
| GET | `/api/planner/segments` | Segment messaging |
| GET | `/api/planner/centers` | Center plans |
| GET | `/api/planner/full` | Complete commercial plan |

## Who uses it

- **Director:** Strategic planning and resource allocation
- **Marketing:** Campaign strategy and segment targeting
- **Management:** Business development direction

## Current Status: Complete
