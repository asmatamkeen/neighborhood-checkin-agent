const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

exports.handler = async (event) => {
  const email = (event.requestContext.authorizer.claims.email || '').toLowerCase();

  const res = await ddb.send(new ScanCommand({ TableName: VOLUNTEERS_TABLE }));
  const person = (res.Items || []).find((v) => (v.email || '').toLowerCase() === email && v.active);

  if (!person) {
    return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'No profile linked to this account' }) };
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({ volunteerId: person.volunteerId, name: person.name, role: person.role }),
  };
};
