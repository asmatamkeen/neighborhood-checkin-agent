const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

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

  const { newVolunteerId, actingPersonId, adminPin } = body;
  if (!checkInId || !newVolunteerId || !actingPersonId || !adminPin) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: 'checkInId, newVolunteerId, actingPersonId, and adminPin are required' }),
    };
  }

  // Only a secretary or joint_secretary may reassign, and only with their correct admin PIN.
  const actorRes = await ddb.send(
    new GetCommand({ TableName: VOLUNTEERS_TABLE, Key: { volunteerId: actingPersonId } })
  );
  const actor = actorRes.Item;
  const isAuthorized =
    actor && actor.adminPin === adminPin && ['secretary', 'joint_secretary'].includes(actor.role);
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
    by: actor.name,
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
