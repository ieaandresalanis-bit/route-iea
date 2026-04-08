# Campaign Intelligence

## Purpose

Deep analytics on campaign performance. Measures ROI, conversion funnels, lead quality, and time-to-close per campaign. Supports breakdown by center, industry, advisor, and ticket size.

## Page

**Route:** `/sales/intelligence`
**Sidebar:** Campaign Intelligence

## What it shows

- **Campaign Leaderboard:** Ranked by ROI with costs, leads, conversions, revenue
- **Funnel Analysis:** Stage breakdown per campaign showing where leads drop off
- **Lead Quality:** Quality scores per campaign (how far leads progress)
- **Time-to-Close:** Average days from lead creation to close per campaign
- **Breakdowns:** Metrics by center, industry, advisor, and ticket size
- **Charts:** Bar charts, area charts, pie charts, funnel charts, treemaps, heatmaps

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/intelligence/full` | Complete dashboard (all data) |
| GET | `/api/intelligence/leaderboard` | Campaign ranking |
| GET | `/api/intelligence/funnels` | Funnel per campaign |
| GET | `/api/intelligence/quality` | Lead quality metrics |
| GET | `/api/intelligence/time-to-close` | Duration metrics |
| GET | `/api/intelligence/breakdown` | By dimension (center, industry, advisor, ticket) |
| POST | `/api/intelligence/costs` | Update campaign costs |

## Who uses it

- **Director:** Campaign ROI assessment
- **Marketing:** Campaign optimization
- **Finance:** Cost-per-acquisition analysis

## Current Status: Complete
