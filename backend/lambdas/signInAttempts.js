const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const ATTEMPTS_TABLE = process.env.ATTEMPTS_TABLE;

const MAX_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 15;

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

// Tracks failed sign-in attempts per email and enforces a short, temporary
// lockout. Deliberately time-limited rather than permanent: someone who knows
// a volunteer's email could otherwise lock them out on purpose, and this app
// is used to confirm vulnerable residents are okay — being locked out of it
// indefinitely is its own kind of harm.
exports.handler = async (event) => {
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const email = (body.email || '').toLowerCase();
  const action = body.action; // 'check' | 'record-failure' | 'clear'

  if (!email || !action) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'email and action are required' }) };
  }

  const existing = await ddb.send(new GetCommand({ TableName: ATTEMPTS_TABLE, Key: { email } }));
  const record = existing.Item;
  const now = Date.now();

  // A lockout that has expired is treated as no lockout at all.
  const lockedUntil = record && record.lockedUntil ? record.lockedUntil : 0;
  const stillLocked = lockedUntil > now;

  if (action === 'check') {
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        locked: stillLocked,
        minutesLeft: stillLocked ? Math.ceil((lockedUntil - now) / 60000) : 0,
      }),
    };
  }

  if (action === 'clear') {
    // Successful sign-in wipes the slate.
    await ddb.send(new DeleteCommand({ TableName: ATTEMPTS_TABLE, Key: { email } }));
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ cleared: true }) };
  }

  if (action === 'record-failure') {
    // If a previous lockout already expired, start counting fresh.
    const priorCount = record && !stillLocked && lockedUntil === 0 ? record.failedCount || 0 : stillLocked ? record.failedCount || 0 : 0;
    const failedCount = priorCount + 1;
    const shouldLock = failedCount >= MAX_ATTEMPTS;

    await ddb.send(
      new PutCommand({
        TableName: ATTEMPTS_TABLE,
        Item: {
          email,
          failedCount: shouldLock ? 0 : failedCount, // reset the counter once locked
          lockedUntil: shouldLock ? now + LOCKOUT_MINUTES * 60000 : 0,
          // DynamoDB removes these rows automatically a day later so the table
          // doesn't accumulate stale attempt records forever.
          expiresAt: Math.floor(now / 1000) + 86400,
        },
      })
    );

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        locked: shouldLock,
        attemptsLeft: shouldLock ? 0 : MAX_ATTEMPTS - failedCount,
        minutesLeft: shouldLock ? LOCKOUT_MINUTES : 0,
      }),
    };
  }

  return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Unknown action' }) };
};
