# Daily Operations (Operacion Diaria)

## Purpose

Operational command center for daily sales activities. Shows what needs to happen today: follow-ups due, inactive leads, priority contacts, deals to push, and advisor workload distribution.

## Page

**Route:** `/sales/ops`
**Sidebar:** Operacion Diaria (first item under Operacion section)

## What it shows

- **Daily Summary KPIs:** Follow-ups today, overdue items, inactive leads, new leads this week
- **Priority Leads:** Top 20 leads ranked by Priority Engine score
- **Deals to Push:** Top 10 late-stage deals that need attention
- **Advisor Priorities:** Per-advisor priority lists with top leads and deals
- **Follow-ups:** Visits with follow-up dates due today or past due

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sales-ops/daily-summary` | KPI counts |
| GET | `/api/sales-ops/priority` | Top priority leads (via Priority Engine) |
| GET | `/api/sales-ops/deals-to-push` | Stalled deals |
| GET | `/api/sales-ops/advisor-priorities` | Per-advisor rankings |
| GET | `/api/sales-ops/follow-ups` | Due follow-ups |
| GET | `/api/sales-ops/inactive` | Leads without contact 14+ days |

## Who uses it

- **Supervisors:** Morning review of team priorities
- **Advisors:** Check personal daily agenda
- **Director:** Quick operational health check

## Dependencies

- Priority Engine (scoring)
- Visits table (follow-ups)
- Leads table (status, contact dates)

## Current Status: Complete
