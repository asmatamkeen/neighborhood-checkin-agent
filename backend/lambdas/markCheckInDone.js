const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const CHECKINS_TABLE = process.env.CHECKINS_TABLE;

exports.handler = async (event) => {
  const checkInId = event.pathParameters && event.pathParameters.checkInId;
  if (!checkInId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'checkInId is required' }) };
  }

  const current = await ddb.send(new GetCommand({ TableName: CHECKINS_TABLE, Key: { checkInId } }));
  if (!current.Item) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Check-in not found' }) };
  }

  const log = current.Item.escalationLog || [];
  log.push({ step: 'done', at: new Date().toISOString() });

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
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ checkInId, status: 'done' }),
  };
};
