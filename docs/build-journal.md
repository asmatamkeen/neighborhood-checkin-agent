# Build Journal — Neighborhood Safety Check-In Agent

Running notes on the actual build process, kept for the "Agents for Humans" builder.aws.com post.
Not polished prose — just honest, specific notes to write from later.

---

## Picking the idea

- Started broad: which hackathon track has the best odds? Landed on **Good Neighbor** —
  fewer people default to building for a *group* instead of an individual, and it's a
  stronger story for judges (community impact > personal productivity).
- First idea (neighborhood food-waste rescue) got stress-tested and replaced. Settled on
  **elder wellness check-ins** — a real, specific problem: in RWAs/gated communities,
  "someone will check on her" often means nobody does, because responsibility is diffuse.
- Deliberately went narrow and specific instead of generic — a hostel-mess-food-waste
  idea got cut because the premise didn't hold up under scrutiny ("mess cooks to headcount,
  so how often does surplus really happen?"). Good lesson: test the premise before building.

## Core design

- Escalation chain: **volunteer → secretary → joint secretary → emergency contact.**
  Modeled on how RWAs actually work (a secretary + joint secretary as fallback), not an
  invented hierarchy.
- The "agent" part isn't just automation — it's a Strands Agents SDK agent with real
  tools (`get_pending_check_ins`, `get_person_by_role`, `send_notification`,
  `update_check_in_status`) and a policy written in plain language in the system prompt,
  not hardcoded if/else. It reasons through each check-in and decides what to do.
- Proof-of-visit mechanic evolved through a few iterations before landing right:
  1. First idea: volunteer PIN (like a login password) — realized this doesn't prove
     the volunteer was *actually there*, just that they know their own PIN.
  2. Pivoted to: resident tells volunteer a code (proof of physical presence).
  3. Realized a *static* code has the same flaw as a password — could be reused
     indefinitely. Landed on: a **fresh OTP generated daily**, texted to the resident
     (or family) via SNS, entered by the volunteer after the visit. This is the version
     that shipped.

## AWS friction, in order (the honest part)

1. **Bedrock model access wall.** New AWS account hit "Operation not allowed" invoking
   Claude via Bedrock — turned out to be Anthropic's First Time Use form, which itself
   failed with "account not authorized," a known new-account issue that can require an
   AWS Support ticket with unpredictable response time.
2. Tried switching to **Amazon Nova Pro** on Bedrock to sidestep the Anthropic-specific
   FTU requirement — hit the *same* "Operation not allowed" error, meaning it was a
   broader account-level Bedrock activation issue, not model-specific.
3. Considered Anthropic's direct API instead — blocked by a **mandatory $5 minimum
   credit purchase**, which we chose not to pay for a hackathon test run.
4. **Landed on Groq** — free, OpenAI-compatible API, reachable through Strands SDK's
   `OpenAIModel` class pointed at Groq's endpoint. This is what shipped. Genuinely the
   right call given the deadline, and it's a clean example of Strands' model-provider
   flexibility (swapping providers was a ~10-line change once we knew where to point it).
5. Smaller but real speed bumps along the way: wrong `zod` major version for the Strands
   SDK peer dependency, wrong `openai` package major version (SDK needed v6, not v4),
   Windows `git` line-ending warnings, a broken `.gitignore` causing a failed `git add .`
   on `node_modules`.

## Building the agent

- The escalation Lambda genuinely runs a tool-calling loop — confirmed by watching it in
  CloudWatch logs pick `escalated_secretary` for all three seeded check-ins on the first
  real run, correctly identifying the seeded secretary by name.
- Kept escalation thresholds configurable via environment variables so they could be set
  to 1/2/3/4 minutes for live demo testing, then restored to realistic values
  (60/180/300/420 minutes) for anything resembling real use.

## Frontend + security iteration (this took several real passes)

- V1: pick your name from a list, no verification at all — a real person flagged
  immediately that this meant anyone could view/act as anyone.
- V2: added a 4-digit PIN per person for actions. Better, but still let anyone
  "claim" an identity the first time by setting a PIN for a name nobody had verified.
- V3: realized the real fix was authentication, not authorization — moved to
  **Amazon Cognito** (email + password), with a PreSignUp Lambda trigger that only
  allows sign-up for emails the secretary has already registered. This closes the
  "claim anyone's identity" hole at the account layer instead of patching around it.
- Also caught and fixed a real server-side gap during this pass: the check-ins API was
  originally returning *all* data and trusting the frontend to filter by role — moved
  that filtering server-side so a volunteer literally cannot fetch another volunteer's
  data even by calling the API directly.

## Production-safety pass (once "just a hackathon demo" became "maybe a real thing")

- Switched `RemovalPolicy` on DynamoDB tables and the Cognito pool from `DESTROY` to
  `RETAIN`, added point-in-time recovery — a redeploy should never be able to wipe real
  residents' data.
- Turned on real Cognito email verification (was auto-confirmed during early testing
  since demo emails weren't real inboxes).
- Added a secretary-facing "run today's assignment now" button, backed by a proper
  Lambda invoking the real assignment function — avoids needing AWS console access for
  a very ordinary admin action.

## Open items / honest limitations (good material for the post's "what's next" section)

- PINs/auth have no lockout on repeated failed attempts yet.
- SMS delivery for the daily OTP is best-effort — logged to CloudWatch as a fallback
  in case real delivery to Indian numbers hits carrier/sandbox restrictions.
- No live-deployed frontend yet (local dev only as of this note) — Amplify deploy still
  to do.
- Haven't yet done a real legal/consent review appropriate for handling real elderly
  residents' emergency contact data (flagged as a pre-pilot requirement, not solved).
