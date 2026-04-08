# IEA Growth Intelligence

**Commercial Intelligence & Growth System**
Ingenieria Electrica Alanis | Guadalajara, Jalisco

---

## What is IEA Growth Intelligence?

IEA Growth Intelligence is an internal commercial operating system built for Ingenieria Electrica Alanis (IEA). It transforms raw CRM data into actionable intelligence, automates sales execution, and provides AI-powered coaching to maximize revenue from the commercial team.

This is not a generic CRM. It is a purpose-built intelligence layer that sits on top of Zoho CRM and turns data into decisions, decisions into actions, and actions into revenue.

## Business Purpose

IEA sells solar energy solutions and electrical engineering services across Mexico. The sales cycle involves prospecting, quoting, negotiating, and closing deals that range from $50K to $2M+ MXN. The commercial team operates across multiple zones (Bajio, Occidente, Centro, Norte) with field advisors managing dozens of leads simultaneously.

IEA Growth Intelligence exists to:

1. **Eliminate blind spots** — Know exactly which leads need attention, which deals are at risk, and which advisors need support
2. **Automate follow-up** — Never let a lead go cold because someone forgot to call back
3. **Prioritize intelligently** — Focus the team's limited time on the highest-value, highest-probability opportunities
4. **Coach in real-time** — Give advisors the exact messages and scripts they need for every situation
5. **Measure everything** — Track what works, kill what doesn't, and continuously improve

## System Scope

### What the system does

- Syncs leads and deals from Zoho CRM
- Scores and prioritizes every lead using a proprietary algorithm (0-20 scale)
- Generates intelligent alerts when leads go cold, deals stall, or advisors underperform
- Creates daily execution tasks for each advisor
- Runs multichannel follow-up sequences (WhatsApp, SMS, Email, CRM tasks)
- Provides AI coaching with personalized messages for every sales situation
- Identifies reactivation opportunities from dormant leads
- Tracks automation performance with full-funnel metrics
- Delivers executive briefings for commercial leadership
- Maps leads geographically for territory planning
- Analyzes campaign ROI and lead source quality

### What the system does NOT do

- It does not replace Zoho CRM — Zoho remains the source of truth for lead data
- It does not send messages automatically (yet) — it generates the messages for advisors to send
- It does not handle invoicing, accounting, or project delivery
- It does not manage fleet operations (legacy fleet module exists but is hidden)

## Current Platform Status

**Phase: Production-Ready Core**

The system is fully built and operational with 18 backend modules, 30 frontend pages, and 138 API endpoints. All major intelligence, automation, and AI layers are complete.

## Major Modules

| Module | Purpose | Page |
|--------|---------|------|
| Commercial Dashboard | KPIs, pipeline, zones, trends | `/sales` |
| Pipeline | Visual Kanban board of all deals | `/sales/pipeline` |
| Leads (Prospectos) | Lead management with filtering | `/leads` |
| Daily Operations | Daily summary and priorities | `/sales/ops` |
| Work Plan | Daily/weekly/monthly advisor plans | `/sales/plan` |
| Sales Coach | AI-powered coaching and scripts | `/sales/coach` |
| Alerts | Automation alerts and tasks | `/sales/alerts` |
| Alert Intelligence | Advanced alert center with views | `/sales/alert-center` |
| War Room | Executive command center | `/sales/war-room` |
| Execution Engine | Task generation and tracking | `/sales/execution` |
| Follow-Up Automation | Multichannel sequence automation | `/sales/followup` |
| Automation Performance | Funnel metrics and A/B testing | `/sales/auto-perf` |
| AI Brain | 4 AI agents for decision support | `/sales/ai` |
| Commercial Map | Geographic lead intelligence | `/sales/map` |
| Strategy / Planning | Strategic commercial planning | `/sales/strategy` |
| Campaign Attribution | Lead source tracking | `/sales/attribution` |
| Campaign Intelligence | Campaign ROI and analytics | `/sales/intelligence` |

## AI Agent Layer

Four specialized AI agents analyze the entire system and produce actionable intelligence:

1. **Commercial Director Agent** — Executive briefing with KPIs, alerts, bottlenecks, and strategic actions
2. **Priority & Opportunity Agent** — Hot leads, deals to push, and reactivation targets ranked by score
3. **Sales Coach Agent** — Personalized coaching with messages, scripts, and objection handling per lead
4. **Reactivation Agent** — Identifies dormant opportunities and suggests recovery strategies

## Technology Stack

- **Backend:** NestJS 10 + Prisma 5.8 + PostgreSQL 15
- **Frontend:** Next.js 14 (App Router) + Tailwind CSS
- **CRM:** Zoho CRM (source of truth)
- **Maps:** Google Maps API
- **Auth:** JWT with role-based access
- **Mobile:** React Native (Expo) — field operations

## Documentation Index

| Document | Path |
|----------|------|
| System Architecture | [/docs/architecture/](architecture/) |
| Module Documentation | [/docs/modules/](modules/) |
| AI Agents | [/docs/agents/](agents/) |
| Automation Layer | [/docs/automation/](automation/) |
| Data Model & Logic | [/docs/data/](data/) |
| Daily Operations Guide | [/docs/operations/](operations/) |
| Roadmap & Status | [/docs/roadmap/](roadmap/) |

---

*IEA Growth Intelligence — Built for Ingenieria Electrica Alanis*
