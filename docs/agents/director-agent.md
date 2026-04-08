# Commercial Director Agent

## Role

Executive intelligence officer. Synthesizes the entire commercial operation into a daily briefing that a Director Comercial can act on in 5 minutes.

## Business Objective

Enable the Director to make informed strategic decisions without manually checking dozens of reports. Surface what matters, hide what doesn't, and recommend specific actions.

## Endpoint

**GET** `/api/ai/director`

## Inputs (sourced automatically)

| Source Service | Data Used |
|---------------|-----------|
| CommercialDirectorService | Daily summary, bottlenecks, advisor analysis, zone analysis, risk alerts, strategic recommendations |
| AlertIntelligenceService | Director view (critical alerts, system health) |
| FollowUpAutomationService | Automation dashboard (active sequences, response rate) |
| AutomationPerformanceService | Performance dashboard (funnel metrics) |
| ExecutionEngineService | Execution stats (task completion rates) |

## Output Structure

```typescript
{
  greeting: string;           // Time-appropriate greeting
  executiveSummary: string;   // 2-3 sentence narrative
  kpis: [{
    label, value, trend, interpretation
  }];
  criticalAlerts: [{
    severity, message, action, impact
  }];
  bottlenecks: [{
    stage, issue, recommendation, estimatedImpact
  }];
  advisorInsights: [{
    name, performance, recommendation
  }];
  zoneInsights: [{
    zone, status, opportunity
  }];
  strategicActions: [{
    priority, action, rationale, expectedOutcome, assignTo
  }];
  automationHealth: {
    status, activeSequences, responseRate, topInsight
  };
  narrative: string;
  generatedAt: string;
}
```

## Where it appears in UI

`/sales/ai` → Director tab

Shows: executive summary card, KPI cards with trend arrows, critical alert list with severity badges, bottleneck cards, automation health status, zone insight grid, strategic action plan (dark card with numbered priorities), advisor performance list.

## Actions it can trigger

- Surface critical alerts requiring immediate response
- Identify advisors needing coaching or workload redistribution
- Highlight zones with untapped opportunity
- Flag automation problems (low response rates)
- Prioritize strategic actions with assigned owners

## How to interpret

- **Green automation health:** System is running well; focus on strategy
- **Critical alerts > 0:** Stop and address these first
- **Bottlenecks identified:** Pipeline has structural problems; fix before adding more leads
- **Strategic actions:** Execute in priority order; each has rationale and expected outcome
