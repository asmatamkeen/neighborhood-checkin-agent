const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));

// Every protected Lambda behind the Cognito authorizer gets the caller's
// verified email in event.requestContext.authorizer.claims.email. This looks
// up which person (and role) that email belongs to — the single source of
// truth for "who is making this request," instead of trusting anything the
// client sends in the request body.
async function getCallerProfile(event, volunteersTable) {
  const email = (event.requestContext.authorizer.claims.email || '').toLowerCase();
  const res = await ddb.send(new ScanCommand({ TableName: volunteersTable }));
  return (res.Items || []).find((v) => (v.email || '').toLowerCase() === email && v.active) || null;
}

module.exports = { getCallerProfile };
