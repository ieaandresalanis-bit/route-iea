# Sales Coach

## Purpose

AI-powered sales coaching that generates personalized messages, call scripts, objection handling, and closing arguments for any lead at any stage. Adapts tone, channel, and strategy based on the lead's context.

## Page

**Route:** `/sales/coach`
**Sidebar:** Sales Coach

## What it shows

- **Stage Selector:** 5 coaching stages (New Lead, Follow-Up, Negotiation, Reactivation, Post-Sale)
- **Tone Selector:** 6 tones (Professional, Warm, Direct, Consultative, High Urgency, Soft Urgency)
- **Lead Search:** Find any lead by name
- **Generated Coaching:** Next best action, timing, channel recommendation
- **Channel Messages:** WhatsApp, SMS, Email, and Call Script — each tailored to stage and tone
- **Closing Arguments:** Objection-response pairs for negotiation stage
- **Suggestion Library:** Pre-built templates organized by stage
- **Usage Stats:** Coaching usage analytics by stage, channel, advisor

## Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/coach/generate` | Generate coaching for a lead |
| GET | `/api/coach/library/:stage` | Pre-built suggestions |
| POST | `/api/coach/track` | Track suggestion usage |
| GET | `/api/coach/stats` | Usage statistics |

## Coaching Stages

| Stage | When to use |
|-------|-------------|
| `new_lead` | First contact with a prospect |
| `follow_up` | Following up after initial contact or quote |
| `negotiation` | Deal in closing stages (quote delivered, contract pending) |
| `reactivation` | Re-engaging a cold or dormant lead |
| `post_sale` | After closing — retention, upsell, referral |

## Business Logic

- Messages use lead context: company name, contact name, industry, value, zone, days since contact
- Tone adjustments modify greeting, CTA, and closing language
- High-value leads (>$300K) get specialized enterprise messaging
- Referral sources trigger social proof messaging
- Call scripts include qualification questions, value propositions, and objection handling

## Who uses it

- **Advisors:** Get ready-to-send messages for any situation
- **New advisors:** Learn best practices through the suggestion library

## Dependencies

- Priority Engine (lead scoring context)
- Leads table (lead details)

## Current Status: Complete
