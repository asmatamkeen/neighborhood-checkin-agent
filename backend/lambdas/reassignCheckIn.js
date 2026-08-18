const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { getCallerProfile } = require('./authHelper');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const CHECKINS_TABLE = process.env.CHECKINS_TABLE;
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

exports.handler = async (event) => {
  const checkInId = event.pathParameters && event.pathParameters.checkInId;
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { newVolunteerId } = body;
  if (!checkInId || !newVolunteerId) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'newVolunteerId is required' }) };
  }

  // Authorization comes from who is actually logged in (verified by Cognito),
  // not anything the client claims in the request body.
  const caller = await getCallerProfile(event, VOLUNTEERS_TABLE);
  const isAuthorized = caller && ['secretary', 'joint_secretary'].includes(caller.role);
  if (!isAuthorized) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: 'Not authorized to reassign' }) };
  }

  const newVolunteerRes = await ddb.send(
    new GetCommand({ TableName: VOLUNTEERS_TABLE, Key: { volunteerId: newVolunteerId } })
  );
  if (!newVolunteerRes.Item) {
    return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'New volunteer not found' }) };
  }

  const current = await ddb.send(new GetCommand({ TableName: CHECKINS_TABLE, Key: { checkInId } }));
  if (!current.Item) {
    return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'Check-in not found' }) };
  }

  const log = current.Item.escalationLog || [];
  log.push({
    step: 'reassigned',
    from: current.Item.assignedVolunteerId,
    to: newVolunteerId,
    by: caller.name,
    at: new Date().toISOString(),
  });

  await ddb.send(
    new UpdateCommand({
      TableName: CHECKINS_TABLE,
      Key: { checkInId },
      UpdateExpression: 'SET assignedVolunteerId = :v, escalationLog = :log',
      ExpressionAttributeValues: { ':v': newVolunteerId, ':log': log },
    })
  );

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({ checkInId, assignedVolunteerId: newVolunteerId }),
  };
};
