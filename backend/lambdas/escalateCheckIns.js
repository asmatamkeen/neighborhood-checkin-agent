const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const sns = new SNSClient({});

const RESIDENTS_TABLE = process.env.RESIDENTS_TABLE;
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const CHECKINS_TABLE = process.env.CHECKINS_TABLE;
const NOTIFY_TOPIC_ARN = process.env.NOTIFY_TOPIC_ARN;

// How long to wait at each stage before escalating further.
// TESTING VALUES — set to 1/2/3/4 minutes so the chain can be watched live.
// IMPORTANT: change these back to realistic values (e.g. 60/120/180/240) before
// the real demo/deploy — see README for the production recommendation.
const REMINDER_AFTER_MIN = 1;       // volunteer gets a reminder 1 min after assignment
const SECRETARY_AFTER_MIN = 2;      // secretary notified 2 min after assignment
const JOINT_SEC_AFTER_MIN = 3;      // joint secretary notified 3 min after assignment
const EMERGENCY_AFTER_MIN = 4;      // emergency contact notified 4 min after assignment

function minutesSince(isoString) {
  return (Date.now() - new Date(isoString).getTime()) / 60000;
}

async function notify(message, subject) {
  if (!NOTIFY_TOPIC_ARN) return;
  await sns.send(new PublishCommand({ TopicArn: NOTIFY_TOPIC_ARN, Message: message, Subject: subject }));
}

async function getVolunteerByRole(role) {
  const res = await ddb.send(new ScanCommand({ TableName: VOLUNTEERS_TABLE }));
  return (res.Items || []).find((v) => v.role === role && v.active);
}

async function appendLog(checkInId, entry) {
  const current = await ddb.send(new GetCommand({ TableName: CHECKINS_TABLE, Key: { checkInId } }));
  const log = (current.Item && current.Item.escalationLog) || [];
  log.push(entry);
  return log;
}

async function updateStatus(checkInId, status, log) {
  await ddb.send(
    new UpdateCommand({
      TableName: CHECKINS_TABLE,
      Key: { checkInId },
      UpdateExpression: 'SET #s = :s, escalationLog = :log',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status, ':log': log },
    })
  );
}

exports.handler = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const scan = await ddb.send(
    new ScanCommand({
      TableName: CHECKINS_TABLE,
      FilterExpression: '#d = :today AND #s <> :done',
      ExpressionAttributeNames: { '#d': 'date', '#s': 'status' },
      ExpressionAttributeValues: { ':today': today, ':done': 'done' },
    })
  );

  const pending = scan.Items || [];
  const actions = [];

  for (const item of pending) {
    const elapsed = minutesSince(item.assignedAt);
    const residentRes = await ddb.send(
      new GetCommand({ TableName: RESIDENTS_TABLE, Key: { residentId: item.residentId } })
    );
    const resident = residentRes.Item;
    if (!resident) continue;

    if (item.status === 'pending' && elapsed >= REMINDER_AFTER_MIN) {
      const log = await appendLog(item.checkInId, { step: 'reminder_sent', at: new Date().toISOString() });
      await updateStatus(item.checkInId, 'reminder_sent', log);
      await notify(
        `Reminder: please check in on ${resident.name} (${resident.unit}) today.`,
        'Check-in reminder'
      );
      actions.push({ checkInId: item.checkInId, action: 'reminder_sent' });
    } else if (item.status === 'reminder_sent' && elapsed >= SECRETARY_AFTER_MIN) {
      const secretary = await getVolunteerByRole('secretary');
      const log = await appendLog(item.checkInId, {
        step: 'escalated_secretary',
        at: new Date().toISOString(),
      });
      await updateStatus(item.checkInId, 'escalated_secretary', log);
      await notify(
        `Check-in for ${resident.name} (${resident.unit}) has not been completed. Please follow up.`,
        'Check-in escalation: secretary'
      );
      actions.push({ checkInId: item.checkInId, action: 'escalated_secretary', notified: secretary?.name });
    } else if (item.status === 'escalated_secretary' && elapsed >= JOINT_SEC_AFTER_MIN) {
      const jointSec = await getVolunteerByRole('joint_secretary');
      const log = await appendLog(item.checkInId, {
        step: 'escalated_joint_secretary',
        at: new Date().toISOString(),
      });
      await updateStatus(item.checkInId, 'escalated_joint_secretary', log);
      await notify(
        `Secretary has not responded. Check-in for ${resident.name} (${resident.unit}) still pending.`,
        'Check-in escalation: joint secretary'
      );
      actions.push({ checkInId: item.checkInId, action: 'escalated_joint_secretary', notified: jointSec?.name });
    } else if (item.status === 'escalated_joint_secretary' && elapsed >= EMERGENCY_AFTER_MIN) {
      const log = await appendLog(item.checkInId, {
        step: 'escalated_emergency',
        at: new Date().toISOString(),
      });
      await updateStatus(item.checkInId, 'escalated_emergency', log);
      await notify(
        `No one has confirmed a check-in on ${resident.name} (${resident.unit}) today. Emergency contact ${resident.emergencyContactName} is being notified.`,
        'Check-in escalation: emergency contact'
      );
      actions.push({ checkInId: item.checkInId, action: 'escalated_emergency' });
    }
  }

  console.log(`Escalation run complete: ${actions.length} actions taken`);
  return { actions };
};