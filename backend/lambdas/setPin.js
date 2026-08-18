const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

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
  const { newPin } = body;

  if (!volunteerId || !/^\d{4}$/.test(newPin || '')) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'A 4-digit PIN is required' }) };
  }

  const current = await ddb.send(new GetCommand({ TableName: VOLUNTEERS_TABLE, Key: { volunteerId } }));
  const person = current.Item;
  if (!person) {
    return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'Person not found' }) };
  }

  // First-time setup only — once a PIN exists, this endpoint won't overwrite it.
  // (A real deployment would add a proper "forgot PIN" recovery flow instead.)
  if (person.pin) {
    return {
      statusCode: 409,
      headers: cors(),
      body: JSON.stringify({ error: 'A PIN is already set for this account' }),
    };
  }

  await ddb.send(
    new UpdateCommand({
      TableName: VOLUNTEERS_TABLE,
      Key: { volunteerId },
      UpdateExpression: 'SET pin = :p',
      ExpressionAttributeValues: { ':p': newPin },
    })
  );

  return { statusCode: 200, headers: cors(), body: JSON.stringify({ volunteerId, pinSet: true }) };
};
