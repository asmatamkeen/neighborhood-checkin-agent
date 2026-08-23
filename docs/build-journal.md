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

---

## Auth hardening — round two (the "wait, we hit that gap too" session)

Started from a genuine question: is this only for the hackathon, or something meant to
actually run for a real community eventually? Decided: build it for real, not as two
separate tracks — most "do it properly" work costs nothing extra and directly helps the
Technical Implementation score too.

Agreed order going in:
1. Two quick, zero-risk safety fixes.
2. Real email verification (the biggest piece).
3. Monitoring — alert *us*, not just residents, if the daily job silently fails.
4. A genuine resident consent process.

### Step 1 — done
- Switched all three DynamoDB tables and the Cognito user pool from
  `RemovalPolicy.DESTROY` to `RemovalPolicy.RETAIN`, turned on point-in-time recovery.
  A bad `cdk deploy` can no longer wipe real people's data.
- Restored escalation timings from demo-speed minutes (1/2/3/4) to realistic hours
  (60/180/300/420 minutes), with a comment explaining how to temporarily lower them
  again for a live demo.
- CDK correctly treated this as an in-place update, not a resource replacement —
  existing seeded data and Cognito accounts survived the deploy untouched.

### Step 2 — real email verification, and everything it surfaced
- Removed auto-confirm from the PreSignUp trigger; kept the "email must already be
  registered by the secretary" check. Cognito now sends a real 6-digit code.
- Hit `global is not defined` immediately — `amazon-cognito-identity-js` expects
  Node's `global` in a browser context. Fixed with a one-line Vite `define` pointing
  `global` at `globalThis`.
- Hit `USER_SRP_AUTH is not enabled for the client` — the library defaults to SRP auth,
  but the Cognito app client was only configured for `USER_PASSWORD_AUTH`. Enabled both.
- **Real bug caught by testing, not by design review:** added a test volunteer through
  the app using the same real email already registered to the secretary. Nothing in
  `addPerson.js` checked for that. Since login resolves "who is this" by scanning for a
  matching email, two people sharing one email meant login could nondeterministically
  become either identity. Fixed by rejecting `addPerson` calls where the email is
  already in use by another active person — email is genuinely the identity key now,
  so it has to be unique.
- **Real gap hit firsthand, not anticipated:** forgot a just-created password mid-testing.
  Cognito's console "Reset password" action doesn't hand you a working password — it
  just invalidates the old one and leaves the account needing a new one, with no UI in
  our app to actually set it. Unblocked manually via
  `aws cognito-idp admin-set-user-password ... --permanent`, then built a proper
  "Forgot password?" flow into the sign-in screen right after (Cognito's native
  forgot-password code + confirm-password calls, same pattern as sign-up verification).

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

### Recurring annoyance worth mentioning in the post
Config values (`API_BASE`, Cognito pool/client IDs) live as fallback constants in source
files, so every time a file got recopied during development, the placeholders came back
and silently broke things — three separate times, each presenting as a different-looking
bug (`ERR_NAME_NOT_RESOLVED`, HTML returned instead of JSON, `undefined` in the UI).
Moving these to a `.env` file is the obvious fix and is still outstanding.