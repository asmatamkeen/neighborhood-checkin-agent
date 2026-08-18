const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const { getCallerProfile } = require('./authHelper');

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

  const { name, phone, email, availableDays, role } = body;

  if (!name || !phone || !email) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: 'Name, phone, and email are all required' }),
    };
  }

  const caller = await getCallerProfile(event, VOLUNTEERS_TABLE);
  const isAuthorized = caller && ['secretary', 'joint_secretary'].includes(caller.role);
  if (!isAuthorized) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: 'Not authorized to add people' }) };
  }

  const volunteerId = `vol_${randomUUID().slice(0, 8)}`;
  const item = {
    volunteerId,
    name,
    phone,
    email: email.toLowerCase(),
    availableDays: availableDays || [],
    role: role || 'volunteer',
    active: true,
  };

  await ddb.send(new PutCommand({ TableName: VOLUNTEERS_TABLE, Item: item }));

  return {
    statusCode: 201,
    headers: cors(),
    body: JSON.stringify({ volunteerId, name, role: item.role, email: item.email }),
  };
};
