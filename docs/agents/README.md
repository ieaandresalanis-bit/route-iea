# AI Agents Documentation

IEA Growth Intelligence includes 4 specialized AI agents that orchestrate the system's intelligence modules into actionable, human-readable outputs.

## Design Philosophy

The agents do not simply forward raw data. They **interpret**, **prioritize**, and **recommend**. Every agent output includes:

1. **What** — the data point or insight
2. **Why it matters** — business impact
3. **What to do** — specific action
4. **By when** — urgency/deadline

## Agents

| Agent | Purpose | Endpoint | Document |
|-------|---------|----------|----------|
| [Commercial Director](director-agent.md) | Executive briefing & strategy | GET `/api/ai/director` | Full doc |
| [Priority & Opportunity](priority-agent.md) | Lead ranking & deal pushing | GET `/api/ai/priorities` | Full doc |
| [Sales Coach](coach-agent.md) | Personalized coaching per lead | POST `/api/ai/coach` | Full doc |
| [Reactivation](reactivation-agent.md) | Dormant opportunity recovery | GET `/api/ai/reactivation` | Full doc |

## Architecture

```
AiAgentsService (orchestrator)
    |
    |--- CommercialDirectorService ----> Director Agent
    |--- PriorityEngineService ---------> Priority Agent
    |--- SalesCoachService -------------> Coach Agent
    |--- AlertIntelligenceService ------> Director + Priority
    |--- ExecutionEngineService --------> Director
    |--- FollowUpAutomationService -----> Director + Reactivation
    |--- AutomationPerformanceService --> Director
```

The `AiAgentsService` injects all 7 core services and composes their outputs into 4 agent-specific responses. It adds interpretation, context, and recommendations on top of raw service data.

## Frontend Location

All agents are accessible from `/sales/ai` (AI Brain page) with 4 tabs, one per agent.
