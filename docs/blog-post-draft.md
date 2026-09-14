# I built an AI agent that nags a neighborhood until someone checks on their elderly neighbors

In my residential welfare association (RWA), checking on elderly residents who live alone runs on goodwill and a WhatsApp group. When a visit gets missed, nothing notices — the family finds out days later. The failure isn't malice, it's diffusion: everyone assumed someone else had it covered. For the AWS Agents for Humans hackathon, I built the thing that notices.

## What it does

- Every morning, each resident gets assigned a volunteer, with a fairness rule based on the last week of history.
- The volunteer visits, then marks the check-in done with an OTP texted to the resident that morning — "done" means somebody was actually there.
- If it isn't done, an AI agent escalates: volunteer → secretary → joint secretary → emergency contact.

The escalation agent runs on the **Strands Agents SDK** with four tools and a policy in plain English in its system prompt: 60 min → reminder, 180 → secretary, 300 → joint secretary, 420 → emergency contact. No hardcoded if/else — the model reasons over the policy per check-in and picks the tool. Every decision lands in an audit log in DynamoDB.

The model runs via Groq. I originally planned Bedrock + Claude, but a new-account activation wall pushed me to Groq's endpoint — a ~10-line change through Strands' `OpenAIModel`. That separation of "which model" from "how the agent reasons" is the best argument for the SDK.

## The failure that changed how I think

Weeks in, the agent started failing with a bare 404: Groq had deprecated the model I was using. Nothing in my code was wrong — a third-party model just stopped existing.

Worse: a reasoning model once burned its whole token budget "thinking" and returned an empty response. The Lambda exited fine. Nothing errored, nothing escalated, for hours.

An agent whose job is noticing when something's wrong needs to notice when *it* is wrong. CloudWatch alarms now email me if assignment fails, if the agent errors twice, or if it hasn't run in 25 hours.

## The unglamorous half

Auth took longer than the agent. V1 was "pick your name from a list" — anyone could act as anyone. V2's PINs still let anyone claim an identity. V3 became real auth: Cognito allowing only secretary-registered emails, server-side role filtering, and a deliberately time-limited lockout — a permanent lock would let anyone who knows your email lock you out, its own harm in a system confirming vulnerable residents are okay.

## What's still rough

Honest, since hackathon writeups usually aren't: member removal is half-built, notifications depend on best-effort SMS, and it's demo data until a real pilot gets consent. The core — an agent that notices, decides, and leaves a receipt — works. The rest is finishing work.

Repo: [github.com/asmatamkeen/neighborhood-checkin-agent](https://github.com/asmatamkeen/neighborhood-checkin-agent)

*Built with Strands Agents SDK for the AWS Agents for Humans hackathon.*
