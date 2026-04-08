# Data Model & Commercial Logic

## Database Overview

The system uses PostgreSQL 15 with Prisma ORM. The schema contains 20+ models organized in three domains:

1. **Fleet Management** (legacy, hidden in UI): Vehicle, Trip, GpsLog, FuelLog, OdometerLog, Incident
2. **Sales/CRM** (active): Lead, VisitRoute, RouteStop, Visit
3. **Intelligence & Automation**: SalesAlert, SalesTask, FollowUpSequence, FollowUpStep, MessageTemplate, ABTest, AutomationAlert, CoachUsage, Campaign

## Core Sales Models

### Lead

The central entity. Every commercial interaction revolves around leads.

| Field | Type | Purpose |
|-------|------|---------|
| companyName | String | Company/business name |
| contactName | String | Primary contact person |
| contactEmail/Phone | String? | Contact channels |
| latitude/longitude | Float | Geolocation for map |
| zone | Enum | Geographic territory (BAJIO, OCCIDENTE, CENTRO, NORTE, OTROS) |
| status | Enum | Pipeline stage (12 values) |
| source | Enum | Lead origin (MANUAL, REFERRAL, WEBSITE, COLD_CALL, TRADE_SHOW, ZOHO_CRM, OTHER) |
| industry | String? | Industry vertical |
| estimatedValue | Float? | Deal value in MXN |
| assignedToId | UUID? | Assigned advisor |
| zohoLeadId | String? | Zoho CRM sync reference |
| lastContactedAt | DateTime? | Last interaction timestamp |

### Pipeline Stages (LeadStatus)

```
PENDIENTE_CONTACTAR     → New, never contacted
INTENTANDO_CONTACTAR    → Attempting first contact
EN_PROSPECCION          → Actively prospecting
AGENDAR_CITA           → Scheduling a meeting
ESPERANDO_COTIZACION    → Quote being prepared
COTIZACION_ENTREGADA    → Quote delivered to client
ESPERANDO_CONTRATO      → Contract pending signature
PENDIENTE_PAGO          → Payment pending
CERRADO_GANADO          → Closed Won ✅
CERRADO_PERDIDO         → Closed Lost ❌
CONTACTAR_FUTURO        → Deferred (contact later)
LEAD_BASURA             → Junk / disqualified
```

**Stage categories:**
- Early: PENDIENTE_CONTACTAR, INTENTANDO_CONTACTAR, EN_PROSPECCION
- Mid: AGENDAR_CITA, ESPERANDO_COTIZACION
- Late: COTIZACION_ENTREGADA, ESPERANDO_CONTRATO, PENDIENTE_PAGO
- Terminal: CERRADO_GANADO, CERRADO_PERDIDO, CONTACTAR_FUTURO, LEAD_BASURA

---

## Priority Score Logic (0-20)

The Priority Engine scores every lead on a 0-20 scale using 5 factors:

### Score Components

| Factor | Range | How it works |
|--------|-------|-------------|
| Stage | 0-12 | Later stages = higher score. PENDIENTE_PAGO = 12, PENDIENTE_CONTACTAR = 0 |
| Value | 0-4 | >500K = 4, >300K = 3, >150K = 2, >50K = 1 |
| Recency | -3 to +2 | Last contact ≤2 days = +2, never contacted = -3 |
| Source | 0-2 | REFERRAL = 2, TRADE_SHOW/ZOHO = 1, others = 0 |
| Aging | -2 to +1 | Created ≤7 days = +1, >90 days = -2 |

### Probability (0-99%)

Base probability by stage (5% to 90%) adjusted by:
- Source quality multiplier (0.8x to 1.4x)
- Inactivity decay (0.5x to 1.0x)
- Value confidence bonus (+5% for deals >300K)

### Urgency Levels

| Level | Trigger |
|-------|---------|
| **Critical** | Late-stage AND overdue, OR high-value AND very overdue |
| **High** | Late-stage, OR high-value AND overdue |
| **Medium** | Overdue or never contacted |
| **Low** | Everything else |

### Ideal Contact Intervals

| Stage | Days |
|-------|------|
| PENDIENTE_CONTACTAR | 1 |
| INTENTANDO_CONTACTAR | 2 |
| EN_PROSPECCION | 5 |
| AGENDAR_CITA | 3 |
| ESPERANDO_COTIZACION | 4 |
| COTIZACION_ENTREGADA | 3 |
| ESPERANDO_CONTRATO | 2 |
| PENDIENTE_PAGO | 1 |

---

## Alert Severity Logic

8 alert types with severity determined by:

| Factor | Effect |
|--------|--------|
| Days overdue | More days = higher severity |
| Deal value | Higher value = escalated severity |
| Pipeline stage | Later stage = more urgent |
| Pattern compounding | Multiple indicators = critical |

**Example:** A $500K lead in ESPERANDO_CONTRATO with no contact for 7 days = **CRITICAL** (late stage + high value + very overdue)

---

## Inactivity Rules

| Threshold | Classification |
|-----------|---------------|
| 0-2 days | Active |
| 3-7 days | Needs follow-up |
| 7-14 days | Warning |
| 14-30 days | Inactive (triggers alerts) |
| 30-60 days | Cold (triggers reactivation) |
| 60-90 days | Dormant |
| 90+ days | Very cold (low reactivation probability) |

## High-Value Rules

| Value (MXN) | Classification | Treatment |
|-------------|---------------|-----------|
| > 1,000,000 | Enterprise | Critical alert if 5+ days no contact |
| > 500,000 | Large | High priority scoring (+4), specialized messaging |
| > 300,000 | High | Probability boost, enhanced monitoring |
| > 150,000 | Medium | Standard priority treatment |
| > 50,000 | Standard | Normal flow |
| ≤ 50,000 | Small | No value score bonus |

## Conversion Definitions

- **Converted:** Lead reaches CERRADO_GANADO status
- **Conversion rate:** CERRADO_GANADO / (total non-terminal leads created in period)
- **Pipeline conversion:** Progression from one stage to the next
- **Campaign conversion:** Leads from campaign that reach CERRADO_GANADO

## Reactivation Rules

A lead is eligible for reactivation if:
1. Not in terminal status (not CERRADO_GANADO, CERRADO_PERDIDO, LEAD_BASURA)
2. AND one of:
   - No contact in 30+ days
   - Never contacted and created 15+ days ago
   - Status is CONTACTAR_FUTURO

## Zones

| Zone | Coverage |
|------|----------|
| BAJIO | Guanajuato, Queretaro, Aguascalientes, San Luis Potosi |
| OCCIDENTE | Jalisco, Michoacan, Colima, Nayarit |
| CENTRO | CDMX, Estado de Mexico, Puebla, Morelos |
| NORTE | Monterrey, Coahuila, Chihuahua |
| OTROS | All other states |
