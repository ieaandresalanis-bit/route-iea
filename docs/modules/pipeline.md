# Pipeline

## Purpose

Visual Kanban board showing all active leads organized by their current pipeline stage. Provides drag-and-drop management of the sales funnel.

## Page

**Route:** `/sales/pipeline`
**Sidebar:** Pipeline

## What it shows

- **Kanban columns** for each pipeline stage (left to right = early to late)
- **Lead cards** within each column showing company name, contact, value, and zone
- Stages displayed: PENDIENTE_CONTACTAR, CONTACTADO, NEGOCIACION, REACTIVACION, PROPUESTA_ENVIADA, PROPUESTA_PRESENTADA, OBJECION, CERRADO_GANADO, CERRADO_PERDIDO

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sales/pipeline-view` | Pipeline stage data |
| GET | `/api/leads?limit=500` | All leads for board |

## Who uses it

- **Advisors:** Manage their pipeline visually
- **Supervisors:** Spot bottlenecks in the funnel

## Current Status: Complete
