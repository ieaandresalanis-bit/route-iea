# Execution Engine (Motor de Ejecucion)

## Purpose

Converts intelligence into action. Automatically generates prioritized daily tasks for each advisor based on alerts, priority scores, stalled deals, inactive leads, and high-value opportunities. Tracks task execution and outcomes.

## Page

**Route:** `/sales/execution`
**Sidebar:** Motor Ejecucion

## What it shows

- **Daily KPIs:** Tasks generated, completed, skipped, completion rate
- **Priority Leads:** From Priority Engine with score and next action
- **Deals to Push:** Late-stage deals needing attention
- **Advisor Workload:** Task distribution across team
- **Task Management:** Filterable task list with status, priority, and action buttons (start, complete, skip, reassign, escalate)

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/execution-engine/generate` | Generate tasks from all sources |
| GET | `/api/execution-engine/advisor/:id/daily` | Advisor daily view |
| GET | `/api/execution-engine/supervisor` | Supervisor control panel |
| GET | `/api/execution-engine/stats` | Historical execution stats |
| PATCH | `/api/execution-engine/:id/start` | Start task |
| PATCH | `/api/execution-engine/:id/complete` | Complete with outcome |
| PATCH | `/api/execution-engine/:id/skip` | Skip with reason |
| PATCH | `/api/execution-engine/:id/reassign` | Reassign to another advisor |
| PATCH | `/api/execution-engine/:id/escalate` | Escalate task |
| POST | `/api/execution-engine/manual` | Create manual task |

## Task Types

| Type | Description |
|------|-------------|
| `call` | Phone call to lead |
| `whatsapp` | WhatsApp message |
| `email` | Email to lead |
| `follow_up` | General follow-up action |
| `reactivation` | Re-engage dormant lead |
| `close_deal` | Push deal to close |
| `escalation` | Escalated from alert |
| `visit` | In-person visit |
| `send_quote` | Send/resend quotation |

## Task Generation Sources

1. **Alerts:** Active alerts converted into tasks
2. **Priority Engine:** Top-scored leads get contact tasks
3. **Stalled Deals:** Late-stage deals without movement get push tasks
4. **Inactive Leads:** Leads going cold get follow-up tasks
5. **High-Value:** High-value leads without recent contact get priority tasks
6. **Manual:** Supervisors can create custom tasks

## Task Lifecycle

```
pending -> in_progress -> completed (with outcome)
                      \-> skipped (with reason)
                      \-> reassigned (to another advisor)
                      \-> escalated (to supervisor)
```

## Outcomes tracked

- success, partial, no_answer, rescheduled, failed
- Pipeline movement recorded (previous stage -> new stage)

## Who uses it

- **Advisors:** Execute daily task queue
- **Supervisors:** Monitor team execution and reassign tasks
- **System:** Auto-generates tasks from intelligence layer

## Dependencies

- Priority Engine (scoring for task prioritization)
- Alert Intelligence (alerts as task source)

## Current Status: Complete
