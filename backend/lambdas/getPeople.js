const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;

exports.handler = async () => {
  const res = await ddb.send(new ScanCommand({ TableName: VOLUNTEERS_TABLE }));
  const people = (res.Items || [])
    .filter((v) => v.active)
    .map((v) => ({
      volunteerId: v.volunteerId,
      name: v.name,
      role: v.role,
      // Never return the actual PIN — only whether one has been set yet,
      // so the frontend knows to show "create your PIN" vs "enter your PIN".
      hasAdminPin: v.role === 'secretary' || v.role === 'joint_secretary' ? Boolean(v.adminPin) : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ people }),
  };
};
