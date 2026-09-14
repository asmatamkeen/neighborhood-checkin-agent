const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { getCallerProfile } = require('./authHelper');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const RESIDENTS_TABLE = process.env.RESIDENTS_TABLE;

exports.handler = async (event) => {
  const caller = await getCallerProfile(event, VOLUNTEERS_TABLE);
  const isOversightRole = caller && ['secretary', 'joint_secretary'].includes(caller.role);
  if (!caller) {
    return {
      statusCode: 403,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'No profile linked to this account' }),
    };
  }

  // Active people list is needed by everyone (volunteers use it for the
  // reassign dropdown on their own cards), so no role gate here.
  const res = await ddb.send(new ScanCommand({ TableName: VOLUNTEERS_TABLE }));
  const people = (res.Items || [])
    .filter((v) => v.active)
    .map((v) => ({ volunteerId: v.volunteerId, name: v.name, role: v.role }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Residents are only relevant to the admin manage panel, so only oversight
  // roles get them. Volunteers receive an empty list.
  let residents = [];
  if (isOversightRole && RESIDENTS_TABLE) {
    const residentsRes = await ddb.send(new ScanCommand({ TableName: RESIDENTS_TABLE }));
    residents = (residentsRes.Items || [])
      .filter((r) => r.active)
      .map((r) => ({ residentId: r.residentId, name: r.name, unit: r.unit }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ people, residents }),
  };
};
