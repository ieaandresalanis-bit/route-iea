# AI Brain

## Purpose

Orchestration layer that combines all intelligence modules into 4 specialized AI agents. Each agent synthesizes data from multiple sources and produces human-readable, actionable insights — not raw data.

## Page

**Route:** `/sales/ai`
**Sidebar:** AI Brain

## What it shows

### 4 Tabs

1. **Director:** Executive briefing, KPIs with interpretation, critical alerts, bottlenecks, zone insights, automation health, strategic action plan
2. **Priorities:** Hot leads ranked by score with next action and deadline, deals to push with risk assessment and closing tips, advisor workload analysis
3. **Coach:** Lead ID input, personalized coaching generation, quick wins, full coaching output (next best action, channel messages, closing arguments), mindset advice
4. **Reactivation:** Dormant opportunity summary, segment strategies with expected conversion, scored target list with expandable details (suggested message, channel, timing)

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ai/director` | Director briefing |
| GET | `/api/ai/priorities` | Priority intelligence |
| POST | `/api/ai/coach` | Coach advice (body: leadId, advisorId, situation?) |
| GET | `/api/ai/reactivation` | Reactivation plan |

## Agent Details

See [/docs/agents/](../agents/) for detailed per-agent documentation.

## Key Design Principle

AI agents **interpret** data, they don't just pass it through. Every output includes:
- What the data means
- Why it matters
- What to do about it
- By when

## Who uses it

- **Director:** Daily AI briefing (Director tab)
- **Supervisors:** Priority review and lead selection (Priorities tab)
- **Advisors:** Get coaching for specific leads (Coach tab)
- **Growth team:** Reactivation planning (Reactivation tab)

## Dependencies

Imports 7 modules: CommercialDirector, PriorityEngine, SalesCoach, AlertIntelligence, ExecutionEngine, FollowUpAutomation, AutomationPerformance

## Current Status: Complete
