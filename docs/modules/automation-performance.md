# Automation Performance (Perf. Automatizacion)

## Purpose

Full-funnel tracking of automation effectiveness. Measures every step from message sent to revenue generated. Supports A/B testing, message ranking, performance alerts, and optimization recommendations.

## Page

**Route:** `/sales/auto-perf`
**Sidebar:** Perf. Automatizacion

## What it shows

### 5 Tabs

1. **Funnel & Breakdowns:** Dark funnel bar chart (sent -> delivered -> opened -> replied -> meeting -> deal -> closed -> revenue), breakdowns by 6 dimensions (channel, trigger, advisor, zone, industry, campaign), top and worst performing sequences
2. **Messages:** Message ranking table with composite score (20% open + 50% reply + 30% advance rate)
3. **A/B Tests:** Create tests (two variants with body/tone), side-by-side comparison, auto-winner detection
4. **Alerts:** Performance alerts with severity colors (low response rate, low conversion, high dropoff, stalled sequences)
5. **Recommendations:** Priority-ordered optimization cards with impact assessment and action steps

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/automation-performance/dashboard` | Full performance dashboard |
| POST | `/api/automation-performance/sync-outcomes` | Sync lead outcomes |
| GET | `/api/automation-performance/messages` | Message ranking |
| GET | `/api/automation-performance/ab-tests` | All A/B tests |
| POST | `/api/automation-performance/ab-tests` | Create A/B test |
| POST | `/api/automation-performance/ab-tests/:id/event` | Record test event |
| PATCH | `/api/automation-performance/ab-tests/:id/winner` | Select winner |
| POST | `/api/automation-performance/alerts/generate` | Generate alerts |
| GET | `/api/automation-performance/alerts` | Open alerts |
| PATCH | `/api/automation-performance/alerts/:id/resolve` | Resolve alert |
| PATCH | `/api/automation-performance/alerts/:id/dismiss` | Dismiss alert |
| PATCH | `/api/automation-performance/sequence/:id/meeting` | Record meeting |
| PATCH | `/api/automation-performance/sequence/:id/deal` | Record deal |
| PATCH | `/api/automation-performance/sequence/:id/close` | Record close with revenue |

## Alert Thresholds

| Type | Threshold | Severity |
|------|-----------|----------|
| Low response rate | < 3% | High |
| Low conversion | < 1% | High |
| High dropoff | > 70% between steps | Medium |
| Stalled sequences | > 5 sequences stalled | Medium |
| Channel underperform | < 2% response | Medium |

## Recommendation Types

1. **Improve message:** Underperforming templates need rewriting
2. **Prioritize channel:** Shift volume to best-performing channel
3. **Scale sequence:** Successful trigger type deserves more enrollment
4. **Fix dropoff:** High step-to-step dropoff needs investigation
5. **Stop underperformer:** Kill sequences with zero conversions

## Who uses it

- **Director:** Monitor automation ROI
- **Supervisors:** Track team automation effectiveness
- **Growth team:** A/B test and optimize messaging

## Current Status: Complete
