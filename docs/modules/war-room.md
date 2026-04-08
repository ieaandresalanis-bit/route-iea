# War Room

## Purpose

Executive command center for the Director Comercial. Consolidates all strategic intelligence into a single view: executive summary, advisor performance, zone analysis, conversion funnel, and strategic recommendations.

## Page

**Route:** `/sales/war-room`
**Sidebar:** War Room

## What it shows

### 5 Tabs

1. **Executive:** Daily/weekly KPIs, narrative summary, risk alerts, strategic actions
2. **Advisors:** Performance table with conversion rates, pipeline values, activity levels, and coaching recommendations
3. **Zones:** Geographic performance analysis with pipeline value, conversion rates, and opportunity assessment per zone
4. **Funnel:** Stage-to-stage conversion analysis showing where leads drop off and bottleneck identification
5. **Strategy:** AI-generated strategic recommendations with rationale, expected outcomes, and assigned owners

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/director/daily` | Daily summary with narrative |
| GET | `/api/director/weekly` | Weekly summary |
| GET | `/api/director/bottlenecks` | Funnel bottleneck detection |
| GET | `/api/director/advisors` | Advisor analysis |
| GET | `/api/director/zones` | Zone analysis |
| GET | `/api/director/conversions` | Stage conversion metrics |
| GET | `/api/director/risks` | Risk alerts |
| GET | `/api/director/recommendations` | Strategic recommendations |
| GET | `/api/director/report` | Full executive report |

## Business Logic

- **Bottleneck detection:** Analyzes stage-to-stage flow to find where leads accumulate or drop off
- **Advisor analysis:** Compares conversion rates, activity levels, pipeline value per advisor
- **Zone analysis:** Evaluates geographic performance and identifies underserved territories
- **Risk alerts:** Identifies strategic risks (unassigned high-value leads, stalled pipelines, advisor performance issues)
- **Recommendations:** AI-generated actions with priority ranking, rationale, and expected impact

## Who uses it

- **Director Comercial:** Primary user — daily strategic review
- **C-Level:** Weekly strategic oversight
- **Supervisors:** Team performance insights

## Current Status: Complete
