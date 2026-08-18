const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

exports.handler = async (event) => {
  const volunteerId = event.pathParameters && event.pathParameters.volunteerId;
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  const { pin } = body;

  if (!volunteerId || !pin) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'PIN is required' }) };
  }

  const current = await ddb.send(new GetCommand({ TableName: VOLUNTEERS_TABLE, Key: { volunteerId } }));
  const person = current.Item;

  // Note: no lockout/rate-limiting on repeated attempts in this demo build —
  // a real deployment would add that before this counts as real security.
  if (!person || person.pin !== pin) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ valid: false, error: 'Incorrect PIN' }) };
  }

  return { statusCode: 200, headers: cors(), body: JSON.stringify({ valid: true }) };
};
