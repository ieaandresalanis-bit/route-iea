# Campaign Attribution (Atribucion Campanas)

## Purpose

Tracks the origin of every lead. Normalizes Zoho CRM source data into a standardized attribution model with campaigns, channels, and source types. Enables accurate ROI measurement.

## Page

**Route:** `/sales/attribution`
**Sidebar:** Atribucion Campanas

## What it shows

- Attribution validation statistics (data quality metrics)
- Campaign dimension table
- Seed and backfill action buttons for data initialization

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/attribution/seed` | Initialize campaign dimensions |
| POST | `/api/attribution/backfill` | Backfill local lead attributions |
| POST | `/api/attribution/sync` | Process Zoho data (leads + deals) |
| GET | `/api/attribution/stats` | Data quality metrics |
| GET | `/api/attribution/campaigns` | All campaigns |
| GET | `/api/attribution/channels` | Channel dimensions |
| GET | `/api/attribution/source-types` | Source type dimensions |

## Channels

Meta, Google, TikTok, Referral, Outbound, Organic, Wiki, WhatsApp, Database, Events, PR, Social

## Source Types

paid, referral, outbound, organic, database

## Who uses it

- **Marketing:** Campaign tracking setup
- **Growth team:** Attribution data quality

## Current Status: Complete
