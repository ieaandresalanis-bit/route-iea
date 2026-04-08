# Follow-Up Automation

## Purpose

Multichannel automated follow-up system. Detects leads needing attention, enrolls them in adaptive sequences (3-7 steps across WhatsApp, SMS, Email, CRM tasks), executes steps on schedule, and tracks engagement. Learns from performance to improve over time.

## Page

**Route:** `/sales/followup`
**Sidebar:** Follow-Up Auto

## What it shows

### 5 Tabs

1. **Dashboard:** 9 KPIs (active sequences, completed, response rate, meeting rate), trigger distribution, channel distribution, recent actions
2. **Sequences:** Performance by trigger type (new_lead, no_response, stalled_deal, cold_lead, reactivation, post_sale) with per-step metrics
3. **Channels:** Funnel visualization per channel (sent -> delivered -> opened -> replied -> advanced)
4. **Leads in Flow:** Active sequences with step progress dots, expandable message details, pause/resume/stop controls
5. **Learning:** Best channel/tone/timing by trigger, system recommendations

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/followup-automation/scan` | Scan and enroll eligible leads |
| POST | `/api/followup-automation/execute` | Execute all pending steps |
| GET | `/api/followup-automation/dashboard` | Main dashboard |
| GET | `/api/followup-automation/leads` | Leads in automation (filters) |
| GET | `/api/followup-automation/performance/sequences` | Sequence performance by trigger |
| GET | `/api/followup-automation/performance/channels` | Channel performance |
| GET | `/api/followup-automation/performance/templates` | Template performance |
| GET | `/api/followup-automation/learning` | Learning insights |
| PATCH | `/api/followup-automation/:id/pause` | Pause sequence |
| PATCH | `/api/followup-automation/:id/resume` | Resume sequence |
| PATCH | `/api/followup-automation/:id/stop` | Stop sequence |
| PATCH | `/api/followup-automation/step/:id/opened` | Mark opened |
| PATCH | `/api/followup-automation/step/:id/replied` | Mark replied |
| PATCH | `/api/followup-automation/step/:id/advanced` | Mark pipeline advance |

## 6 Trigger Types

| Trigger | Condition |
|---------|-----------|
| `new_lead` | Created within 3 days, not yet contacted |
| `no_response` | 3-15 days without response |
| `stalled_deal` | Late-stage deal, no movement 5+ days |
| `cold_lead` | 15-90 days without contact |
| `reactivation` | Previously active, now dormant 30+ days |
| `post_sale` | Recently closed won |

## Sequence Structure

Each sequence consists of 3-7 steps with:
- **Channel rotation:** WhatsApp -> Email -> SMS -> CRM Task
- **Adaptive timing:** Faster for urgent leads, slower for cold leads
- **Tone variation:** Matches trigger context (consultative for new, urgent for stalled)
- **Contact limits:** Max 2 messages/day, 5/week, 12h minimum between

## Stop Conditions (auto-detected)

- Lead reached terminal status (closed won/lost/junk)
- Lead responded to a message
- Lead advanced in pipeline
- Advisor manually intervened
- Sequence expired (max steps reached)

## Who uses it

- **System:** Runs scans and executions on schedule
- **Supervisors:** Monitor automation health and pause/stop sequences
- **Director:** Review learning insights for strategy

## Dependencies

- Priority Engine (scoring for enrollment and prioritization)
- Leads table (lead context for message generation)

## Current Status: Complete
