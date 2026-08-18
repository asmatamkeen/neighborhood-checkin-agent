const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;

// Cognito calls this automatically before a sign-up completes. Its one job now:
// refuse to create an account unless this email was already registered by the
// secretary/joint secretary. This is what stops a stranger from signing up and
// claiming to be "Ravi Kumar" — the email itself is the thing only the real
// person was ever told. Cognito handles the actual email verification code
// itself after this trigger passes (see autoVerify in the CDK stack).
exports.handler = async (event) => {
  const email = (event.request.userAttributes.email || '').toLowerCase();

  const res = await ddb.send(new ScanCommand({ TableName: VOLUNTEERS_TABLE }));
  const match = (res.Items || []).find((v) => (v.email || '').toLowerCase() === email && v.active);

  if (!match) {
    throw new Error('This email is not registered. Ask your secretary to add you first.');
  }

  return event;
};
