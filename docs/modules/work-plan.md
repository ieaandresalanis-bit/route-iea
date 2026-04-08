# Work Plan (Plan de Trabajo)

## Purpose

Structured planning tool that organizes advisor workload into daily, weekly, and monthly views. Helps advisors plan their time and helps supervisors balance team capacity.

## Page

**Route:** `/sales/plan`
**Sidebar:** Plan de Trabajo

## What it shows

### Daily View
- Advisor selector dropdown
- Critical leads requiring immediate action
- Follow-ups due today
- High-priority leads from Priority Engine
- Deals in closing stages

### Weekly View
- Calendar breakdown by day
- Pipeline progression tracking
- Weekly goals and activity targets

### Monthly View
- Monthly KPIs and projections
- Conversion targets
- Pipeline value trends

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/work-plan/advisors` | List advisors with lead counts |
| GET | `/api/work-plan/daily?advisorId=` | Daily plan (optional advisor filter) |
| GET | `/api/work-plan/weekly?advisorId=` | Weekly plan |
| GET | `/api/work-plan/monthly?advisorId=` | Monthly summary |

## Who uses it

- **Advisors:** Plan their day and week
- **Supervisors:** Review advisor workload and balance assignments

## Dependencies

- Priority Engine (lead scoring for daily priorities)
- Leads, Visits tables

## Current Status: Complete
