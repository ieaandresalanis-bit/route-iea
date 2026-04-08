# Commercial Dashboard (Panel Comercial)

## Purpose

The main entry point for commercial intelligence. Provides a real-time overview of the entire sales operation: KPIs, pipeline health, zone performance, advisor rankings, and weekly trends.

## Page

**Route:** `/sales`
**Sidebar:** Panel Comercial (first item)

## What it shows

- **KPI Cards:** Total leads, total clients, conversion rate, pipeline value ($MXN), average deal size, visits in last 30 days
- **Pipeline Funnel:** Visual breakdown of leads by stage with count and value per stage
- **Zone Breakdown:** Performance by geographic zone (Bajio, Occidente, Centro, Norte, Otros) with lead count, pipeline value, client count, and conversion rate
- **Advisor Performance Table:** Each advisor's leads, clients, conversion rate, pipeline value, and visit count
- **Weekly Trends:** 12-week chart of leads created vs. leads converted

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sales/kpis` | All KPI metrics |
| GET | `/api/sales/by-zone` | Zone breakdown |
| GET | `/api/sales/by-status` | Status funnel |
| GET | `/api/sales/advisors` | Advisor performance |
| GET | `/api/sales/pipeline-view` | Pipeline stages |
| GET | `/api/sales/trends` | Weekly trends (12 weeks) |

## Who uses it

- **Director Comercial:** Daily review of overall health
- **Supervisors:** Monitor team and zone performance
- **Advisors:** Quick check of personal metrics

## Dependencies

- Leads table (all queries)
- Visits table (visit counts)
- Users table (advisor data)

## Current Status: Complete
