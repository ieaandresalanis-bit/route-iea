# Alert Intelligence (Alert Center)

## Purpose

Advanced alert management with role-specific views (Advisor, Supervisor, Director, Zone). Detects 8 types of commercial problems with intelligent severity classification, priority scoring, and risk-of-loss estimation.

## Page

**Route:** `/sales/alert-center`
**Sidebar:** Alert Intelligence

## What it shows

- **Alert Center Dashboard:** Full alert inventory with KPIs, filters (status, advisor, zone, type, severity), and action buttons
- **Supervisor View:** Team performance scores, per-advisor alert stats, escalated alerts
- **Director View:** Strategic alerts, zone risk analysis, system health metrics, weekly trends
- **Zone View:** Geographic alert analysis with opportunity scoring

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/alert-intelligence/generate` | Generate all alert types |
| GET | `/api/alert-intelligence/center` | Full alert center (with filters) |
| GET | `/api/alert-intelligence/view/advisor/:id` | Advisor view |
| GET | `/api/alert-intelligence/view/supervisor` | Supervisor view |
| GET | `/api/alert-intelligence/view/director` | Director view |
| GET | `/api/alert-intelligence/view/zone/:zone` | Zone view |
| PATCH | `/api/alert-intelligence/:id/resolve` | Resolve alert |
| PATCH | `/api/alert-intelligence/:id/acknowledge` | Acknowledge |
| PATCH | `/api/alert-intelligence/:id/escalate` | Escalate |
| PATCH | `/api/alert-intelligence/:id/dismiss` | Dismiss |
| PATCH | `/api/alert-intelligence/:id/assign` | Reassign |
| POST | `/api/alert-intelligence/:id/trigger` | Trigger action |

## 8 Alert Types

| Type | Trigger | Example Severity |
|------|---------|-----------------|
| `no_followup` | Lead without activity 3+ days | High if 7+ days |
| `stalled_deal` | Late-stage deal without movement | Critical if 10+ days |
| `low_activity_advisor` | Advisor activity below 50% expected | Critical if zero activity |
| `low_conversion` | Advisor conversion below 15% | High if below 5% |
| `zone_opportunity` | Zone with 40%+ unattended leads | Critical if 70%+ |
| `weekly_target_risk` | Weekly KPIs missed by 50%+ | Critical if all 3 missed |
| `high_value_no_contact` | Lead 200K+ MXN, 5+ days no contact | Critical if 1M+ value |
| `final_stage_stuck` | Contract/Payment stage, 2+ days stuck | Critical if 7+ days |

## Severity Logic

Severity is determined by a combination of:
- **Time elapsed** (days since last contact or stage change)
- **Deal value** (higher value = more severe)
- **Pipeline stage** (later stages = more urgent)
- **Pattern** (multiple indicators compound severity)

## Priority Score (0-100)

Separate from lead score. Used to rank alerts within the alert center. Higher = more urgent action needed. Calculated based on days overdue, deal value, stage proximity to close, and compounding risk factors.

## Who uses it

- **Director:** Strategic alerts, zone risks, system health (Director View)
- **Supervisors:** Team monitoring, escalations (Supervisor View)
- **Advisors:** Personal alert queue (Advisor View)

## Current Status: Complete
