// Strands Agents SDK powered escalation agent.
//
// Instead of hardcoded if/else branching, this agent is given a set of
// tools (read pending check-ins, look up a person by role, send a
// notification, update a check-in's status) and reasons about which
// action to take for each check-in, given the escalation policy in its
// system prompt. This is the "brain" of the Neighborhood Safety
// Check-In Agent, built with @strands-agents/sdk per the hackathon
// requirement.

import { Agent, tool } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import z from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const sns = new SNSClient({});

const RESIDENTS_TABLE = process.env.RESIDENTS_TABLE;
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const CHECKINS_TABLE = process.env.CHECKINS_TABLE;
const NOTIFY_TOPIC_ARN = process.env.NOTIFY_TOPIC_ARN;

// Escalation policy, in minutes since assignment. Kept as named constants
// (not hidden in the prompt) so they're easy to tune for demo vs. real use.
const POLICY = {
  reminderAfterMin: Number(process.env.REMINDER_AFTER_MIN || 60),
  secretaryAfterMin: Number(process.env.SECRETARY_AFTER_MIN || 120),
  jointSecretaryAfterMin: Number(process.env.JOINT_SEC_AFTER_MIN || 180),
  emergencyAfterMin: Number(process.env.EMERGENCY_AFTER_MIN || 240),
};

function minutesSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

// ---------- Tools the agent can call ----------

const getPendingCheckIns = tool({
  name: 'get_pending_check_ins',
  description:
    "Fetch today's check-ins that are not yet marked done, including how many minutes have elapsed since assignment and the resident's details.",
  inputSchema: z.object({}),
  callback: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const scan = await ddb.send(
      new ScanCommand({
        TableName: CHECKINS_TABLE,
        FilterExpression: '#d = :today AND #s <> :done',
        ExpressionAttributeNames: { '#d': 'date', '#s': 'status' },
        ExpressionAttributeValues: { ':today': today, ':done': 'done' },
      })
    );
    const items = scan.Items || [];
    const enriched = [];
    for (const item of items) {
      const residentRes = await ddb.send(
        new GetCommand({ TableName: RESIDENTS_TABLE, Key: { residentId: item.residentId } })
      );
      const resident = residentRes.Item;
      if (!resident) continue;
      enriched.push({
        checkInId: item.checkInId,
        status: item.status,
        minutesSinceAssigned: Math.round(minutesSince(item.assignedAt)),
        residentName: resident.name,
        residentUnit: resident.unit,
        emergencyContactName: resident.emergencyContactName,
      });
    }
    return JSON.stringify(enriched);
  },
});

const getPersonByRole = tool({
  name: 'get_person_by_role',
  description:
    "Look up the currently active person for a given role: 'volunteer', 'secretary', or 'joint_secretary'.",
  inputSchema: z.object({
    role: z.enum(['volunteer', 'secretary', 'joint_secretary']),
  }),
  callback: async ({ role }) => {
    const res = await ddb.send(new ScanCommand({ TableName: VOLUNTEERS_TABLE }));
    const person = (res.Items || []).find((v) => v.role === role && v.active);
    return person ? JSON.stringify({ name: person.name, phone: person.phone }) : 'none found';
  },
});

const sendNotification = tool({
  name: 'send_notification',
  description: 'Send an SMS/email notification via SNS about a check-in status.',
  inputSchema: z.object({
    subject: z.string().describe('Short subject line for the notification'),
    message: z.string().describe('The notification body'),
  }),
  callback: async ({ subject, message }) => {
    if (!NOTIFY_TOPIC_ARN) return 'no topic configured, skipped';
    await sns.send(new PublishCommand({ TopicArn: NOTIFY_TOPIC_ARN, Subject: subject, Message: message }));
    return 'sent';
  },
});

const updateCheckInStatus = tool({
  name: 'update_check_in_status',
  description:
    "Advance a check-in to a new status and append an entry to its escalation log. Valid statuses: 'reminder_sent', 'escalated_secretary', 'escalated_joint_secretary', 'escalated_emergency'.",
  inputSchema: z.object({
    checkInId: z.string(),
    newStatus: z.enum([
      'reminder_sent',
      'escalated_secretary',
      'escalated_joint_secretary',
      'escalated_emergency',
    ]),
    reason: z.string().describe('Brief reason for this decision, for the audit log'),
  }),
  callback: async ({ checkInId, newStatus, reason }) => {
    const current = await ddb.send(new GetCommand({ TableName: CHECKINS_TABLE, Key: { checkInId } }));
    const log = (current.Item && current.Item.escalationLog) || [];
    log.push({ step: newStatus, reason, at: new Date().toISOString() });
    await ddb.send(
      new UpdateCommand({
        TableName: CHECKINS_TABLE,
        Key: { checkInId },
        UpdateExpression: 'SET #s = :s, escalationLog = :log',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': newStatus, ':log': log },
      })
    );
    return `updated ${checkInId} to ${newStatus}`;
  },
});

// ---------- The agent ----------

function buildEscalationAgent() {
  const model = new OpenAIModel({
    api: 'chat',
    apiKey: process.env.GROQ_API_KEY,
    clientConfig: {
      baseURL: 'https://api.groq.com/openai/v1',
    },
    modelId: 'llama-3.3-70b-versatile',
    temperature: 0.1, // low temperature: this is an operational decision, not creative writing
    maxTokens: 1024,
  });

  return new Agent({
    model,
    printer: false,
    tools: [getPendingCheckIns, getPersonByRole, sendNotification, updateCheckInStatus],
    systemPrompt: `You are the escalation agent for a neighborhood elder check-in system.

Your job: for every pending check-in, decide whether it needs to move to the
next stage of this escalation chain, based on minutesSinceAssigned:

- status "pending", elapsed >= ${POLICY.reminderAfterMin} min -> send a reminder to the
  assigned volunteer via send_notification, then update_check_in_status to "reminder_sent".
- status "reminder_sent", elapsed >= ${POLICY.secretaryAfterMin} min -> look up the secretary
  with get_person_by_role, notify them, update status to "escalated_secretary".
- status "escalated_secretary", elapsed >= ${POLICY.jointSecretaryAfterMin} min -> look up the
  joint_secretary, notify them, update status to "escalated_joint_secretary".
- status "escalated_joint_secretary", elapsed >= ${POLICY.emergencyAfterMin} min -> notify that
  the resident's emergency contact is being alerted, update status to "escalated_emergency".

Do nothing for a check-in that hasn't crossed its next threshold yet.
Always call update_check_in_status after sending a notification, with a short reason.
Work through every pending check-in returned by get_pending_check_ins, one at a time.
When finished, summarize in one short sentence how many check-ins were escalated and to what stage.`,
  });
}

export const handler = async () => {
  const agent = buildEscalationAgent();
  const result = await agent.invoke(
    'Run the escalation check now: fetch pending check-ins and take whatever action the policy requires for each.'
  );
  console.log('Agent summary:', result.lastMessage);
  return { summary: result.lastMessage };
};
