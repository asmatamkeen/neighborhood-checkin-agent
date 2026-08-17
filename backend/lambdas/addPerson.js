const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

exports.handler = async (event) => {
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { actingPersonId, adminPin, name, phone, email, availableDays, role, newAdminPin } = body;

  if (!actingPersonId || !adminPin || !name || !phone) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: 'Missing required fields' }),
    };
  }

  const actorRes = await ddb.send(
    new GetCommand({ TableName: VOLUNTEERS_TABLE, Key: { volunteerId: actingPersonId } })
  );
  const actor = actorRes.Item;
  const isAuthorized =
    actor && actor.adminPin === adminPin && ['secretary', 'joint_secretary'].includes(actor.role);
  if (!isAuthorized) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: 'Not authorized to add people' }) };
  }

  const finalRole = role || 'volunteer';
  const needsAdminPin = finalRole === 'secretary' || finalRole === 'joint_secretary';
  if (needsAdminPin && !/^\d{4}$/.test(newAdminPin || '')) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: 'A 4-digit admin PIN is required for secretary/joint secretary roles' }),
    };
  }

  const volunteerId = `vol_${randomUUID().slice(0, 8)}`;
  const item = {
    volunteerId,
    name,
    phone,
    email: email || '',
    availableDays: availableDays || [],
    role: finalRole,
    active: true,
  };
  if (needsAdminPin) item.adminPin = newAdminPin;

  await ddb.send(new PutCommand({ TableName: VOLUNTEERS_TABLE, Item: item }));

  return {
    statusCode: 201,
    headers: cors(),
    body: JSON.stringify({ volunteerId, name, role: item.role }),
  };
};
