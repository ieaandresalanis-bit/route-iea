# Sales Coach Agent

## Role

Personal sales coach. Generates contextual coaching, messages, scripts, and objection handling for a specific lead based on their current situation.

## Business Objective

Ensure every advisor knows exactly what to say, when to say it, and through which channel — regardless of experience level. Standardize best practices while personalizing to each lead's context.

## Endpoint

**POST** `/api/ai/coach`

## Inputs

```json
{
  "leadId": "uuid",
  "advisorId": "uuid or 'current'",
  "situation": "optional context string"
}
```

The agent automatically retrieves:
- Lead details (company, contact, status, value, zone, industry)
- Visit history (last 5 visits)
- Priority Engine score
- Days since last contact

## Output Structure

```typescript
{
  situation: string;      // "Energia Solar MTY — Etapa: PENDIENTE_CONTACTAR..."
  coaching: {
    stage: string;
    nextBestAction: {
      action, timing, channel, priority
    };
    messages: {
      whatsapp: string;
      sms: string;
      email: { subject, body };
      callScript: string;
    };
    closingArguments?: [{
      objection, response
    }];
    toneUsed: string;
  };
  quickWins: string[];    // 2-4 immediate actions
  mindset: string;        // Motivational coaching advice
  generatedAt: string;
}
```

## Where it appears in UI

`/sales/ai` → Coach tab

- Input form for Lead ID and optional situation context
- Generate button triggers coaching
- Results: situation summary (indigo card), quick wins (green card), full coaching with channel messages (expandable), closing arguments (yellow cards), mindset (dark card)

Can also be reached by clicking a hot lead in the Priorities tab.

## Actions it can trigger

- Advisor copies and sends WhatsApp message
- Advisor uses call script for phone call
- Advisor sends email from template
- Advisor handles objection using closing arguments

## How to interpret

- **Next Best Action:** This is the single most impactful thing to do right now
- **Quick Wins:** Low-effort, high-impact actions — do these immediately
- **Channel Messages:** Ready-to-send messages — personalize brackets like [Tu Nombre] before sending
- **Mindset:** Coaching philosophy for this type of interaction
