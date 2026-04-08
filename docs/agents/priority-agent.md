# Priority & Opportunity Agent

## Role

Opportunity radar. Identifies the highest-value, highest-probability actions for today and ranks them by impact.

## Business Objective

Ensure the sales team spends their limited time on the leads and deals most likely to generate revenue. No lead should be forgotten; no high-value opportunity should be missed.

## Endpoint

**GET** `/api/ai/priorities`

## Inputs

| Source Service | Data Used |
|---------------|-----------|
| PriorityEngineService | Top leads of day (scored 0-20), top deals to push, advisor priority lists |
| Leads database | Cold leads for reactivation targeting |

## Output Structure

```typescript
{
  summary: string;          // "Hoy tienes X leads calientes ($XK)..."
  hotLeads: [{
    id, company, contact, score, probability, urgency,
    value, reason, nextAction, deadline
  }];
  dealsToPush: [{
    id, company, stage, value, daysInStage,
    risk, action, closingTip
  }];
  reactivationTargets: [{
    id, company, lastContact, previousValue,
    reason, approach
  }];
  advisorWorkload: [{
    name, totalLeads, hotLeads, recommendation
  }];
  generatedAt: string;
}
```

## Where it appears in UI

`/sales/ai` → Priorities tab

- Hot leads shown as urgency-colored cards (red = critical, orange = high, blue = medium) — click any lead to jump to Coach tab
- Deals to push shown in table with risk column and closing tips
- Advisor workload grid showing balance and recommendations

## Actions it can trigger

- Direct advisor to contact specific leads TODAY
- Highlight deals at risk of being lost
- Surface reactivation opportunities
- Identify workload imbalances across team

## How to interpret

- **Urgency CRITICAL:** Act within hours. These leads are high-value AND at risk of going cold
- **Score 15+/20:** Extremely high-priority lead — close to revenue
- **Risk RED on deals:** Deal has been stalled too long — risk of loss is real
- **Advisor with many hot leads but no capacity:** Reassign or provide support
