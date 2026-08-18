const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const { getCallerProfile } = require('./authHelper');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const RESIDENTS_TABLE = process.env.RESIDENTS_TABLE;
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

  const {
    name,
    unit,
    preferredTime,
    preferredMethod,
    notes,
    residentPhone,
    emergencyContactName,
    emergencyContactPhone,
  } = body;

  if (!name || !unit || !emergencyContactName || !emergencyContactPhone) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const caller = await getCallerProfile(event, VOLUNTEERS_TABLE);
  const isAuthorized = caller && ['secretary', 'joint_secretary'].includes(caller.role);
  if (!isAuthorized) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: 'Not authorized to add residents' }) };
  }

  const residentId = `res_${randomUUID().slice(0, 8)}`;
  const item = {
    residentId,
    name,
    unit,
    preferredTime: preferredTime || '18:00',
    preferredMethod: preferredMethod || 'visit',
    notes: notes || '',
    residentPhone: residentPhone || '',
    emergencyContactName,
    emergencyContactPhone,
    consentGiven: true,
    active: true,
  };

  await ddb.send(new PutCommand({ TableName: RESIDENTS_TABLE, Item: item }));

  return { statusCode: 201, headers: cors(), body: JSON.stringify(item) };
};
