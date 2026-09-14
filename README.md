# neighborhood-checkin-agent

An AI agent that makes sure somebody actually checks on elderly residents living alone in a housing colony — and escalates to a human being when nobody does.

Built for the AWS Agents for Humans hackathon (Good Neighbor Agents track), using the [Strands Agents SDK](https://github.com/strands-agents).

## The problem

In residential welfare associations (RWAs) and gated communities across India, checking on elderly residents who live alone usually runs on goodwill and a WhatsApp group. Someone volunteers to visit, but "someone will check on her" often means nobody does — responsibility is diffuse, and when a visit gets missed, there's no system that notices. The family finds out days later, if at all.

This project replaces that with a small, opinionated pipeline:

- Every morning, each active resident is assigned a volunteer.
- The volunteer visits (or calls) and marks the check-in done with an OTP that was texted to the resident that morning — so "done" means somebody was actually there, not just that a button got clicked.
- If the check-in isn't marked done, an agent escalates along a chain that mirrors how RWAs actually work: **volunteer → secretary → joint secretary → emergency contact.**

## Why it's an agent, not a cron job with if-statements

The escalation logic is a [Strands Agents SDK](https://github.com/strands-agents/sdk) agent with four tools and a policy written in plain English in its system prompt:

| Tool | What it does |
|---|---|
| `get_pending_check_ins` | Fetches today's unfinished check-ins with minutes elapsed since assignment |
| `get_person_by_role` | Finds the currently active person for a role (volunteer / secretary / joint_secretary) |
| `send_notification` | Sends SMS/email via SNS |
| `update_check_in_status` | Advances the check-in to the next stage and appends to its audit log |

The policy: 60 minutes → reminder to the volunteer. 180 minutes → notify the secretary. 300 minutes → notify the joint secretary. 420 minutes → alert the resident's emergency contact.

The model reasons over that policy per check-in and decides what to do — there's no hardcoded branching in the escalation path. Changing the policy means editing the prompt or an environment variable, not rewrites. Every decision lands in an `escalationLog` list on the check-in record, so the full reasoning trail is inspectable in DynamoDB.

The model runs on `openai/gpt-oss-120b` via **Groq**'s OpenAI-compatible endpoint, using Strands' `OpenAIModel` pointed at Groq's base URL. (Originally Bedrock + Claude — a new-account Bedrock activation wall and a hackathon deadline pushed us to Groq; swapping providers turned out to be a ~10-line change, which is a genuine credit to how Strands separates "which model" from "how the agent reasons.")

## Architecture

See [architecture-diagram.html](architecture-diagram.html) for the visual version.

```
React dashboard (Vite)
        │
        ▼
API Gateway ── Cognito authorizer (all routes)
        │
        ▼
12 Lambda functions ──► DynamoDB (Residents, Volunteers, Check-ins, Sign-in attempts)
        │                    ▲
        │                    │ reads/writes
        ▼                    │
SNS (OTP texts, escalation notifications)
        
EventBridge schedules:
  - daily assignment @ 2:30 AM
  - escalation agent every 30 minutes (or triggered on demand from the dashboard)
```

The escalation agent itself is a separate Lambda that runs the Strands tool-calling loop.

## What's in the repo

```
backend/
  agent/           # the Strands escalation agent (the interesting part)
  lambdas/         # assignment, OTP verification, reassign, people CRUD, triggers
frontend/
  src/             # React dashboard — volunteer view + secretary oversight view
infra/
  lib/             # CDK stack: everything above, deployable
docs/
  build-journal.md # honest notes from the build, including what broke
  data-model.md    # DynamoDB schemas
```

## Running it

Prerequisites: Node 20+, an AWS account with CDK bootstrapped, and a Groq API key (free).

```bash
# infra
cd infra
npm install
export GROQ_API_KEY=...        # read at synth time, baked into the Lambda env
export OPS_ALERT_EMAIL=...     # optional: CloudWatch alarm emails
npx cdk deploy

# frontend
cd ../frontend
npm install
npm run dev
```

Seed data lives in `docs/data-model.md`. Escalation thresholds are environment variables (`REMINDER_AFTER_MIN`, `SECRETARY_AFTER_MIN`, `JOINT_SEC_AFTER_MIN`, `EMERGENCY_AFTER_MIN`), so for a demo you can drop them to 1/2/3/4 minutes and watch the whole chain fire within a few minutes.

## Design decisions worth explaining

**Daily OTP as proof of visit.** Earlier iterations used a volunteer PIN, which just proves the volunteer knows their own password. A static resident-side code had the same flaw. A fresh OTP texted to the resident each morning, entered by the volunteer after the visit, is the first version where "marked done" actually correlates with someone having been there.

**Escalation chain mirrors the real org.** RWAs have secretaries and joint secretaries — the fallback chain isn't invented, it's borrowed from how the colony already makes decisions.

**Soft deletes only.** Removing a volunteer or resident deactivates the record; history stays intact. Two guards prevent foot-guns: you can't remove the last secretary (nobody could run assignment), and you can't remove a volunteer with unfinished check-ins today (reassign first).

**Failure alarms, because the agent failing silently is the worst-case scenario.** A system whose entire job is noticing when something's wrong needs to notice when *it* is wrong. CloudWatch alarms email a real person if the assignment job fails, if the escalation agent errors twice in a row, or if the assignment job doesn't run at all in 24 hours.

## Honest limitations

- SMS delivery is best-effort; every OTP is also logged to CloudWatch as a fallback.
- Removing a person deactivates their record but doesn't delete their Cognito login.
- The model ID is pinned to a Groq model, and Groq deprecates models — this already bit us once (see the build journal). Any project that depends on a specific third-party model ID should expect occasional maintenance.
- Resident data in the demo is synthetic.

More detail on all of the above, including the debugging stories, is in [docs/build-journal.md](docs/build-journal.md).

## License

MIT — see [LICENSE](LICENSE).
