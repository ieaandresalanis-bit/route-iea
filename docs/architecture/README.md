# System Architecture

## Overview

IEA Growth Intelligence is a three-tier commercial intelligence platform that transforms CRM data into automated actions and AI-powered insights.

```
ZOHO CRM (Source of Truth)
    |
    | sync / attribution
    v
BACKEND (NestJS + PostgreSQL)
    |
    |--- Priority Engine (scoring)
    |--- Alert Intelligence (detection)
    |--- Execution Engine (task generation)
    |--- Follow-Up Automation (sequences)
    |--- Sales Coach (messaging AI)
    |--- Commercial Director (analytics)
    |--- Campaign Intelligence (ROI)
    |--- AI Agents (orchestration)
    |
    v
FRONTEND (Next.js Dashboard)
    |
    |--- Commercial Dashboard
    |--- War Room
    |--- AI Brain
    |--- Maps, Alerts, Plans, etc.
```

## Data Flow

### 1. Data Ingestion

```
Zoho CRM --[sync]--> Campaign Attribution Module --[normalize]--> PostgreSQL (leads table)
```

Leads flow from Zoho CRM into the system via the Campaign Attribution module, which normalizes source data, assigns campaign dimensions, and stores enriched lead records in PostgreSQL. Each lead retains its Zoho IDs (`zohoLeadId`, `zohoContactId`, `zohoAccountId`, `zohoDealId`) for bidirectional sync.

### 2. Intelligence Pipeline

```
Leads (raw data)
    |
    v
Priority Engine ----> Score (0-20) + Probability (%) + Urgency Level
    |
    v
Alert Intelligence ----> Alerts (8 types, 4 severity levels)
    |
    v
Commercial Director ----> Bottlenecks, Advisor Analysis, Zone Analysis, Risk Alerts
    |
    v
AI Agents ----> Executive Briefings, Priority Rankings, Reactivation Plans
```

Every lead is scored by the Priority Engine. Scores feed into Alert Intelligence, which detects problems. The Commercial Director module analyzes patterns across the pipeline. AI Agents synthesize all of this into human-readable, actionable intelligence.

### 3. Execution Pipeline

```
Priority Engine + Alert Intelligence
    |
    v
Execution Engine ----> Daily Tasks (call, email, WhatsApp, visit, quote)
    |                   Assigned to specific advisors
    v
Follow-Up Automation ----> Multi-step sequences (3-7 steps)
    |                       WhatsApp, SMS, Email, CRM Tasks
    v
Automation Performance ----> Funnel tracking, A/B tests, optimization
```

Intelligence is converted into action through the Execution Engine (one-time tasks) and Follow-Up Automation (multi-step sequences). Performance is tracked end-to-end from message sent to deal closed.

### 4. Decision Flow

```
Director / Supervisor opens War Room or AI Brain
    |
    v
Reviews: KPIs, Alerts, Bottlenecks, Advisor Performance
    |
    v
Decides: Resource allocation, coaching needs, strategic pivots
    |
    v
Actions: Reassign leads, trigger automations, adjust strategy
    |
    v
System: Generates tasks, sends sequences, tracks outcomes
```

## Module Dependency Graph

```
PriorityEngineModule (core scoring — no dependencies)
    ^
    |--- SalesOpsModule
    |--- WorkPlanModule
    |--- CommercialDirectorModule
    |--- ExecutionEngineModule
    |--- FollowUpAutomationModule
    |--- SalesCoachModule
    |--- AutomationEngineModule

AlertIntelligenceModule (alert detection — no module deps)

AutomationPerformanceModule (funnel tracking — no module deps)

CampaignAttributionModule (source tracking — no deps)
CampaignIntelligenceModule (ROI analytics — no deps)
CommercialPlannerModule (strategy — no deps)

AiAgentsModule (orchestration layer)
    |--- imports ALL of the above
```

The Priority Engine is the most critical dependency — 7 modules depend on it for lead scoring. The AI Agents module sits at the top of the dependency graph, importing all intelligence and execution modules to orchestrate them into unified agent outputs.

## Infrastructure

| Component | Technology | Port | Purpose |
|-----------|-----------|------|---------|
| Database | PostgreSQL 15 | 5432 | Data storage |
| Backend API | NestJS 10 | 3000 | Business logic + API |
| Frontend | Next.js 14 | 3001 | User interface |
| CRM | Zoho CRM | — | Source of truth |
| Maps | Google Maps API | — | Geographic intelligence |

## Authentication

- JWT-based authentication with role-based access control
- Roles: SUPERADMIN, OPERATIONS, OPERATOR
- All API endpoints protected by `JwtAuthGuard`
- Token stored as `route_iea_token` in localStorage
- Global prefix: `/api/` on all backend routes

## API Response Format

All API responses follow a standard envelope:

```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-04-05T20:00:00.000Z"
}
```

Applied automatically by the `TransformInterceptor`.
