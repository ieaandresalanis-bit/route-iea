# Automation Layer

## Overview

IEA Growth Intelligence has three interconnected automation systems:

1. **Execution Engine** — Generates one-time tasks from intelligence
2. **Follow-Up Automation** — Runs multi-step sequences over days/weeks
3. **Automation Performance** — Tracks and optimizes everything

## How They Connect

```
Intelligence Layer (Priority Engine + Alert Intelligence)
    |
    v
Execution Engine -----> One-time tasks (call, email, WhatsApp)
    |                   Per advisor, per day
    |
Follow-Up Automation --> Multi-step sequences (3-7 steps)
    |                    Auto-enrolled, auto-executed
    |
    v
Automation Performance --> Funnel tracking
    |                      A/B testing
    |                      Recommendations
    v
Learning Loop ----------> Better messages, channels, timing
```

## Execution Engine

**Purpose:** Convert intelligence into daily action items

**Task Sources:**
1. Active alerts (converted to tasks)
2. Priority Engine scores (top leads get contact tasks)
3. Stalled deals (late-stage deals get push tasks)
4. Inactive leads (cold leads get follow-up tasks)
5. High-value opportunities (priority attention tasks)
6. Manual creation (supervisor-assigned)

**Task Lifecycle:** pending → in_progress → completed/skipped/reassigned/escalated

**Key Metric:** Task completion rate (target: >80%)

## Follow-Up Automation

**Purpose:** Ensure systematic, multi-touch follow-up without manual effort

**Enrollment Triggers:**
| Trigger | Condition | Sequence Length |
|---------|-----------|----------------|
| new_lead | Created <3 days, not contacted | 4-5 steps |
| no_response | 3-15 days without reply | 4-6 steps |
| stalled_deal | Late-stage, 5+ days stuck | 3-4 steps |
| cold_lead | 15-90 days no contact | 3-5 steps |
| reactivation | 30+ days dormant | 3-4 steps |
| post_sale | Recently closed won | 3 steps |

**Channel Rotation:** WhatsApp → Email → SMS → CRM Task

**Safety Controls:**
- Max 2 messages per day per lead
- Max 5 messages per week per lead
- Minimum 12 hours between messages
- Auto-stop on: reply, pipeline advance, advisor intervention, terminal status

**Key Metric:** Reply rate (target: >15%)

## Automation Performance

**Purpose:** Measure, test, and optimize automation effectiveness

**Full Funnel Tracked:**
```
Messages Sent → Delivered → Opened → Replied → Meeting → Deal → Closed → Revenue
```

**Breakdowns Available:**
- By channel (WhatsApp, Email, SMS, CRM)
- By trigger (new_lead, no_response, etc.)
- By advisor
- By zone
- By industry
- By campaign

**A/B Testing:**
- Compare two message variants (different body, tone, subject)
- Track per-variant: sent, opened, replied, converted
- Auto-winner detection based on statistical significance
- Minimum sample size configurable

**Alert Thresholds:**
| Metric | Threshold | Severity |
|--------|-----------|----------|
| Response rate | < 3% | High |
| Conversion rate | < 1% | High |
| Step-to-step dropoff | > 70% | Medium |
| Stalled sequences | > 5 | Medium |
| Channel response | < 2% | Medium |

**Recommendation Engine:**
1. Improve underperforming messages
2. Shift volume to best channel
3. Scale successful trigger types
4. Fix high-dropoff sequences
5. Kill zero-conversion sequences

**Key Metric:** Revenue per sequence (target: positive ROI)

## Monitoring Checklist

Daily:
- [ ] Check automation performance dashboard
- [ ] Review any critical alerts
- [ ] Verify sequences are executing (not stalled)

Weekly:
- [ ] Review A/B test results
- [ ] Act on recommendations
- [ ] Check funnel metrics by channel

Monthly:
- [ ] Full automation performance review
- [ ] Update message templates based on learnings
- [ ] Adjust contact frequency limits if needed
