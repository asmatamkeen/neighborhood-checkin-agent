# I built an AI agent that nags a neighborhood until someone checks on their elderly neighbors

*How I used the Strands Agents SDK to turn "someone will check on her" from a vague promise into a system with receipts.*

In the residential welfare association (RWA) where my family lives, there's a list of elderly residents who live alone. Checking on them runs on goodwill and a WhatsApp group. Someone says "I'll visit Lakshmi aunty today" — and most days someone does. But "most days" is doing a lot of work in that sentence. When a visit gets missed, there is no system that notices. The family finds out days later, if at all.

The failure mode isn't malice. It's diffusion. Everyone assumed someone else had it covered.

So for the AWS Agents for Humans hackathon, I built the thing that notices. This post is the story of building it — including the parts that broke.

## What it does

**Neighborhood Safety Check-In Agent**, in one paragraph:

- Every morning, each resident gets assigned a volunteer (with a fairness rule that looks at the last 7 days of history, so the same three people don't quietly do every weekend).
- The volunteer visits or calls, then marks the check-in done with an OTP that was texted to the resident that morning. "Done" means somebody was actually there — not that a button got clicked.
- If the check-in isn't done, an AI agent escalates along a chain that mirrors how RWAs actually work: volunteer → secretary → joint secretary → emergency contact.

The escalation agent is built on the **Strands Agents SDK**. It has four tools — `get_pending_check_ins`, `get_person_by_role`, `send_notification`, `update_check_in_status` — and an escalation policy written in plain English in its system prompt (60 minutes → reminder, 180 → secretary, 300 → joint secretary, 420 → emergency contact). There is no hardcoded if/else in the escalation path. The model reads the pending check-ins, reasons over the policy, and decides which tool to call for each one. Every decision lands in an `escalationLog` list on the check-in record, so the full audit trail is inspectable in DynamoDB.

The whole stack is AWS: Lambda, DynamoDB, SNS, API Gateway, Cognito, EventBridge, CloudWatch — defined in CDK and deployable with one command.

## The model provider story nobody warns you about

I planned to use Bedrock + Claude. Then a fresh AWS account hit the "Operation not allowed" wall invoking models — which turned out to be Anthropic's First Time Use form, which itself failed with "account not authorized," a known new-account issue that can require an AWS Support ticket with unpredictable response time. Tried Amazon Nova instead — same wall. Considered Anthropic's direct API — mandatory $5 minimum credit purchase, which I declined to pay for a hackathon test.

Landed on **Groq**: free, OpenAI-compatible, reachable through Strands' `OpenAIModel` pointed at a different base URL. Swapping model providers was a ~10-line change. That's the real pitch for Strands right there — "which model" and "how the agent reasons" are genuinely separated.

Then, weeks later, it broke again: Groq deprecated the model I was using (`llama-3.3-70b-versatile`), and the agent started failing every scheduled run with a bare `404`. Nothing in my code was wrong. A third-party model I depended on just stopped existing. One-line fix to the replacement model — but the lesson is worth stating: **any project pinned to a specific model ID should expect it to be deprecated eventually.** Budget for that maintenance or pin to a versioned endpoint.

## The silent failure that changed how I think about alarms

While testing, two separate failures taught me that "the code ran without crashing" and "the system worked" are different claims:

1. An IAM permission gap broke the daily assignment job with a silent `AccessDeniedException` — found only by reading logs.
2. A reasoning model burned its entire token budget on internal "thinking" and returned an empty response with zero tool calls. The Lambda exited successfully. Nothing errored. Nothing escalated. For hours.

That second one is the nightmare scenario for this particular system: an agent whose entire job is noticing when something's wrong, failing in a way nothing notices. So the project now has three CloudWatch alarms wired to real email:

- Assignment job errors → email immediately.
- Escalation agent fails twice in a row → email (that's roughly an hour of missed escalations).
- Assignment job hasn't run at all in 25 hours → email, for the case where nothing errors and the dashboard just quietly stays empty.

## Auth: the unglamorous half of the project

The agent itself took days. Making it safe took longer, and almost every fix came from testing as a real user rather than from design review:

- **V1** was "pick your name from a list." A real person pointed out within minutes that anyone could act as anyone.
- **V2** added per-person PINs — which still let anyone claim an unclaimed identity first.
- **V3** accepted that this was an *authentication* problem, not an authorization patch: Amazon Cognito with a PreSignUp Lambda that only permits sign-up for emails the secretary has already registered.
- The check-ins API originally returned everything and trusted the frontend to filter by role. Now the filtering is server-side; a volunteer cannot fetch another volunteer's data even by calling the API directly.
- Sign-in lockout after 3 failures is deliberately *time-limited* (15 minutes), because a permanent lock would let anyone who knows your email lock you out on purpose — and in a system that confirms vulnerable residents are okay, locking out the wrong person indefinitely is its own kind of harm.

## What I'd tell someone building their first agent

1. **Write the policy in plain language before writing code.** If you can't state the escalation rules in five bullet points a non-engineer could check, the agent prompt won't save you.
2. **Tools should be boring and inspectable.** Mine read from DynamoDB and write an audit log. The boring-ness is the feature — you can watch exactly what the agent did and why.
3. **A demo breaks differently than a system.** Demos break loudly. Systems fail silently. Build the alarms before you think you need them — you will, and you'd rather find out from an email than from an 8-hour-old dashboard showing a check-in that should have escalated at hour one.
4. **Test auth as an attacker, not a user.** Every real security fix I made came from trying to misuse the flow, not from reviewing the design.

## What's still rough

Worth being honest about, since hackathon writeups usually aren't:

- **Member removal is half-built.** Adding residents and volunteers works end to end. Removal exists in the data model (soft-delete, so history survives) but the admin UI for it needs more testing, and it should also disable the person's Cognito login — right now it doesn't.
- **Escalation notifications depend on SMS actually arriving.** The agent's decisions and audit log are solid, but the final hop — an SMS to an Indian number via SNS — is best-effort. A missed SMS means the right decision got made and nobody heard about it. Email fallback and per-stage retries are next.
- **It's a hackathon build with demo data.** A real pilot needs residents' consent, real contact numbers, and the Cognito paid tier for adaptive auth.

None of that changes the core bet: the hard part — an agent that notices, decides, and leaves a receipt — works. The rest is finishing work.

The repo is public with the full CDK stack, the agent, and a build journal with more war stories: [github.com/asmatamkeen/neighborhood-checkin-agent](https://github.com/asmatamkeen/neighborhood-checkin-agent)

*Built with the Strands Agents SDK for the AWS Agents for Humans hackathon. Resident data shown is synthetic.*
