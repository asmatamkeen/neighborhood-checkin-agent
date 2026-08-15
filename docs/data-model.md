# Data model

We use a single DynamoDB table per entity type, kept intentionally simple for the hackathon build.

## Table: Residents

| Field | Type | Example | Notes |
|---|---|---|---|
| residentId | String (PK) | `res_001` | Unique ID |
| name | String | `Lakshmi Rao` | Mock data for demo |
| unit | String | `House 12, Green Park Colony` | |
| preferredTime | String | `18:00` | Daily check-in time |
| preferredMethod | String | `call` / `visit` | |
| notes | String | `Prefers evening visits` | Optional |
| emergencyContactName | String | `Suresh Rao (son)` | |
| emergencyContactPhone | String | `+91XXXXXXXXXX` | Mock number for demo |
| consentGiven | Boolean | `true` | Required before agent manages this resident |
| active | Boolean | `true` | Secretary can pause a resident |

## Table: Volunteers

| Field | Type | Example | Notes |
|---|---|---|---|
| volunteerId | String (PK) | `vol_001` | Unique ID |
| name | String | `Ravi Kumar` | |
| phone | String | `+91XXXXXXXXXX` | Used for SNS notifications |
| email | String | `ravi@example.com` | Fallback notification channel |
| availableDays | List<String> | `["Mon","Wed","Fri"]` | |
| role | String | `volunteer` / `secretary` / `joint_secretary` | Determines escalation routing |
| active | Boolean | `true` | |

## Table: CheckIns

| Field | Type | Example | Notes |
|---|---|---|---|
| checkInId | String (PK) | `chk_2026-08-15_res_001` | Composite: date + residentId |
| residentId | String | `res_001` | Foreign key |
| assignedVolunteerId | String | `vol_001` | Set each morning by the agent |
| date | String | `2026-08-15` | ISO date |
| status | String | `pending` / `done` / `reminder_sent` / `escalated_secretary` / `escalated_joint_secretary` / `escalated_emergency` | Current state, drives the escalation logic |
| assignedAt | String (ISO timestamp) | | |
| completedAt | String (ISO timestamp) | Optional | Set when marked done |
| escalationLog | List<Map> | `[{step: "reminder_sent", at: "..."}]` | Audit trail — great for demo video, shows the agent's reasoning trail |

## Why this shape

- One row per resident per day in `CheckIns` keeps the state machine simple: each day starts fresh with `status: pending`.
- `escalationLog` gives us a clean, inspectable trail of every decision the agent made — this is genuinely useful for the demo video, since we can show the JSON/log as "proof" the agent reasoned through each step, not just sent one message.
- `role` on Volunteers lets the same table represent volunteers, secretary, and joint secretary — one lookup table instead of three.

## Consent

Residents are only added by the secretary, and `consentGiven` must be `true` before the agent will include them in a daily assignment. This is documented in the README as the intended real-world flow (opt-in, secretary-managed).
