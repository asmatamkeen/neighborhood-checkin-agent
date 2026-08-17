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
  if (!checkInId) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'checkInId is required' }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  const { otp } = body;
  if (!otp) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Code is required' }) };
  }

  const current = await ddb.send(new GetCommand({ TableName: CHECKINS_TABLE, Key: { checkInId } }));
  if (!current.Item) {
    return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'Check-in not found' }) };
  }

  // The OTP was generated fresh for this specific check-in this morning and sent to the
  // resident/family — only someone who was actually there today would have it.
  if (current.Item.otp !== otp) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: "That code doesn't match today's code — ask again" }) };
  }

  const volunteerRes = await ddb.send(
    new GetCommand({ TableName: VOLUNTEERS_TABLE, Key: { volunteerId: current.Item.assignedVolunteerId } })
  );
  const volunteerName = volunteerRes.Item ? volunteerRes.Item.name : 'Unknown volunteer';

  const log = current.Item.escalationLog || [];
  log.push({ step: 'done', by: volunteerName, verifiedByOtp: true, at: new Date().toISOString() });

  await ddb.send(
    new UpdateCommand({
      TableName: CHECKINS_TABLE,
      Key: { checkInId },
      UpdateExpression: 'SET #s = :s, completedAt = :c, escalationLog = :log',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': 'done',
        ':c': new Date().toISOString(),
        ':log': log,
      },
    })
  );

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({ checkInId, status: 'done' }),
  };
};
