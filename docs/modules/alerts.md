# Alerts (Alertas)

## Purpose

Automation-driven alert and task system. Detects problems automatically (inactive leads, stalled deals, low activity) and generates actionable alerts and tasks for advisors.

## Page

**Route:** `/sales/alerts`
**Sidebar:** Alertas

## What it shows

### Alerts Tab
- KPI cards: Open alerts, Critical alerts, Pending tasks, Completed tasks
- Alert list with severity indicators (critical, high, medium, low)
- Status filters: Open, Acknowledged, Resolved, Dismissed
- Actions: acknowledge, resolve, dismiss

### Tasks Tab
- Auto-generated tasks from the automation engine
- Status filters: Pending, In Progress, Completed, Skipped
- Task details: type, lead, advisor, due date, priority

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/automation/run` | Run all automations |
| GET | `/api/automation/alerts` | List alerts (filters: status, type, severity, advisorId) |
| GET | `/api/automation/alerts/stats` | Alert KPIs |
| PATCH | `/api/automation/alerts/:id` | Update alert status |
| GET | `/api/automation/tasks` | List tasks (filters: advisorId, status, type, date) |
| GET | `/api/automation/tasks/stats` | Task KPIs |
| PATCH | `/api/automation/tasks/:id` | Update task status |

## Alert Types

| Type | Trigger |
|------|---------|
| `inactive_48h` | No contact in 48 hours |
| `inactive_72h` | No contact in 72 hours |
| `inactive_7d` | No contact in 7 days |
| `deal_stuck` | Deal stalled in late stage |
| `reactivation` | Cold lead with reactivation potential |
| `low_activity` | Advisor below activity threshold |
| `high_value_unattended` | High-value lead without attention |

## Who uses it

- **Advisors:** Check and act on personal alerts
- **Supervisors:** Monitor team alert levels
- **System:** Runs automations on schedule

## Current Status: Complete
