# Reactivation Agent

## Role

Opportunity recovery specialist. Scans the entire database for dormant leads that could be reactivated, scores them by recovery potential, and generates a structured reactivation plan.

## Business Objective

Recover lost revenue from leads that went cold. Many dormant leads represent real opportunity — timing, budget, or priorities may have changed. This agent ensures none are forgotten.

## Endpoint

**GET** `/api/ai/reactivation`

## Inputs

- All non-terminal leads with no contact in 30+ days (or never contacted after 15+ days)
- Leads marked as CONTACTAR_FUTURO
- Follow-up automation data (to check if already in a sequence)
- Priority Engine scoring (for reactivation score calculation)

## Output Structure

```typescript
{
  summary: string;           // "20 dormant opportunities, $850K total value..."
  totalOpportunity: string;  // "$850K"
  targets: [{
    id, company, contact, lastContact, daysSinceContact,
    previousStage, estimatedValue, reactivationScore (0-100),
    reason, approach, suggestedMessage, suggestedChannel,
    bestTimeToContact, inAutomation (boolean)
  }];
  strategies: [{
    segment, count, approach, expectedConversion
  }];
  generatedAt: string;
}
```

## Reactivation Score (0-100)

Composite score based on:
- **Value weight (0-30):** Higher deal value = higher recovery priority
- **Recency weight (0-25):** More recently active = higher chance of recovery
- **Stage advancement (0-25):** Further in pipeline before going dormant = warmer
- **Contact info (0-10):** Has phone and/or email = reachable
- **Priority Engine boost (0-10):** Base lead score contribution

## Where it appears in UI

`/sales/ai` → Reactivation tab

- Summary card with total opportunity value
- Strategy cards by segment (30-60 days, 60-90 days, 90+ days) with expected conversion rates
- Scrollable target list with reactivation score badge, expandable details showing suggested message, channel, and timing

## Segment Strategies

| Segment | Approach | Expected Conversion |
|---------|----------|-------------------|
| Dormidos 30-60 dias | Direct follow-up — maintain conversation | 15-25% |
| Dormidos 60-90 dias | Re-engagement with value (demo, study) | 10-15% |
| Dormidos >90 dias | New approach: case study + special offer | 5-8% |

## Actions it can trigger

- Enroll dormant leads into follow-up automation sequences
- Provide advisors with ready-to-send reactivation messages
- Identify leads worth personal outreach vs. automated sequences
- Flag leads already in automation (avoid double-contact)

## How to interpret

- **Score 70+:** High reactivation potential — personal outreach recommended
- **Score 40-70:** Moderate potential — automation sequence appropriate
- **Score <40:** Low potential — automated only, don't spend manual time
- **In Automation = true:** Already being handled; no additional manual action needed
