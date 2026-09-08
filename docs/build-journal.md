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
- Added a fairness fix to daily assignment: originally the "who has done the fewest
  check-ins" counter reset every run, so it only balanced within a single day and never
  noticed if the same person worked every weekend and quietly did more than everyone
  else over time. Fixed by scanning the last 7 days of real check-in history before
  assigning. Also fixed the day-of-week check to use India local time instead of the
  Lambda's UTC clock, since an early-morning run in UTC could land on the wrong
  calendar day for volunteers in India.
- Caught via testing (not design review): forgot to grant the assignment Lambda read
  access on the check-ins table after adding the fairness fix, which needs to *read*
  history it previously only *wrote*. Broke the daily job with a silent
  `AccessDeniedException` until the CloudWatch logs were checked directly.

### Reflection worth keeping for the post
This stretch was slower than building the agent itself, and it's worth explaining why
in the post rather than glossing over it: the agent is a linear pipeline with one happy
path. Auth has to hold up against every way someone could misuse it, most of which don't
show up as errors — they show up as things quietly working *wrong* (viewing someone
else's dashboard, claiming someone else's identity, two people silently sharing one
identity). Every one of tonight's real security fixes came from actually testing the
flow as a real user, not from anticipating it in the design — a decent argument for why
"just ship it, we'll fix bugs later" is a much riskier approach specifically for auth
than for most other features.

### Testing both roles with one inbox
- Only had one real email, so only the secretary path had been verified. Used Gmail's
  `+alias` trick (`me+ravi@gmail.com`, `me+priya@gmail.com`) — Cognito treats each as a
  separate account, but every verification code still lands in one real inbox. Let both
  the secretary and volunteer experiences get tested properly without extra email accounts.
- Confirmed the OTP proof-of-visit flow end to end: pulled the day's code from the
  `AssignCheckInsFn` CloudWatch logs (the fallback we built for exactly this, since the
  seeded phone numbers aren't real), entered it as the volunteer, watched the check-in
  flip to done.
- **UX problem surfaced while testing:** a person already added to the members table
  still has to click "First time here? Create an account," because being in the RWA's
  member list and having a login are two different things. Obvious once you know the
  design, genuinely confusing if you don't. Worth rewording before real volunteers use it.

### Sign-in lockout — and why it's time-limited, not permanent
- Added a 3-strikes rule: three wrong passwords locks the account for 15 minutes.
- Chose a *temporary* lockout deliberately. A permanent lock would mean anyone who knows
  a volunteer's email could deliberately fail three times and lock them out on purpose.
  In an app whose whole job is confirming vulnerable residents are okay, locking the
  wrong person out indefinitely is its own kind of harm — so the fix had to not create a
  worse failure mode than the one it prevents.
- Successful sign-in clears the counter; so does completing a password reset, so the
  forgot-password flow doubles as the escape hatch if someone does get locked out.
- Attempt records auto-expire after a day via DynamoDB TTL, so the table doesn't
  accumulate stale rows.
- Skipped Cognito's paid advanced-security tier (adaptive auth, compromised-credential
  detection) for now — worth revisiting before a real pilot, noted as a deliberate
  tradeoff rather than an oversight.

### Failure alarms
Two silent failures (see below) made it obvious that "the code ran without crashing"
isn't the same as "the system worked." Added three CloudWatch alarms wired to an SNS
email topic:
1. Assignment job throws an error → email immediately.
2. Escalation agent fails twice in a row (covers ~1 hour) → email, since this is the
   one where a missed check-in silently stops escalating to anyone.
3. Assignment job hasn't run at all in 25 hours → catches the case where nothing errors,
   nothing happens, and the dashboard just quietly stays empty.

### Recurring annoyance worth mentioning in the post
Config values (`API_BASE`, Cognito pool/client IDs) live as fallback constants in source
files, so every time a file got recopied during development, the placeholders came back
and silently broke things — three separate times, each presenting as a different-looking
bug (`ERR_NAME_NOT_RESOLVED`, HTML returned instead of JSON, `undefined` in the UI).
Moving these to a `.env` file is the obvious fix and is still outstanding.

## A live dependency broke mid-project (worth noting for anyone forking this)

On 2026-09-08, weeks after the escalation agent was first built and working, it started
failing every single scheduled run with `ModelError: 404`. Root cause: Groq deprecated
`llama-3.3-70b-versatile` (the model the agent was calling) on 2026-06-17, migrating
users to `openai/gpt-oss-120b`. Nothing in our code was wrong — a third-party model we
depended on simply stopped existing.

- **Diagnosis path:** CloudWatch showed 100% error rate on `EscalateCheckInsFn` with the
  error count graph flat at 1 and success rate flat at 0%. Expanding the actual log line
  showed the "404" text; a web search on Groq's model deprecation page confirmed the exact
  model and exact replacement.
- **Fix:** one line — swap the `modelId` string. Everything else (tools, prompt, agent
  structure) was untouched, which is a nice demonstration of how cleanly Strands
  separates "which model" from "how the agent reasons."
- **The real lesson for the post:** this is exactly the kind of failure the CloudWatch
  alarms (built earlier — see "Failure alarms" above) exist to catch. Silent failures in
  a system whose entire job is noticing when something's wrong are the worst-case
  scenario — worth stating plainly in the write-up rather than glossing over. Also worth
  listing as a known risk in the README: any project depending on a specific third-party
  model ID should expect it to eventually be deprecated, and should either pin to a
  stable/versioned endpoint if the provider offers one, or budget for occasional
  model-ID maintenance.

## Open items / honest limitations (good material for the post's "what's next" section)

- No lockout tuning beyond the basic 3-strikes/15-minute rule; no adaptive/compromised-
  credential detection (Cognito's paid tier covers this, skipped for now).
- SMS delivery for the daily OTP is best-effort — logged to CloudWatch as a fallback
  in case real delivery to Indian numbers hits carrier/sandbox restrictions.
- No live-deployed frontend yet (local dev only as of this note) — Amplify deploy still
  to do.
- Config values still live as source-code fallback constants rather than a `.env` file —
  caused repeated silent breakage during development, not yet fixed properly.
- Haven't yet done a real legal/consent review appropriate for handling real elderly
  residents' emergency contact data (flagged as a pre-pilot requirement, not solved).