const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { getCallerProfile } = require('./authHelper');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));
const RESIDENTS_TABLE = process.env.RESIDENTS_TABLE;
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const CHECKINS_TABLE = process.env.CHECKINS_TABLE;

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

// Soft-delete (deactivate) a resident or volunteer. Records stay in the table
// so historical check-ins and the audit trail still resolve, but the person
// stops appearing in assignment, reassign, and people lists.
//
// One lambda serves both entity kinds: the API path determines which —
//   DELETE /residents/{residentId}  -> deactivate a resident
//   DELETE /people/{volunteerId}    -> deactivate a volunteer
exports.handler = async (event) => {
  const params = (event.pathParameters || {}) || {};
  const kind = params.residentId ? 'resident' : 'volunteer';
  const id = params.residentId || params.volunteerId;

  if (!id) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Missing id in path' }) };
  }

  const caller = await getCallerProfile(event, VOLUNTEERS_TABLE);
  const isAuthorized = caller && ['secretary', 'joint_secretary'].includes(caller.role);
  if (!isAuthorized) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: 'Not authorized to remove people' }) };
  }

  if (kind === 'resident') {
    const current = await ddb.send(new GetCommand({ TableName: RESIDENTS_TABLE, Key: { residentId: id } }));
    if (!current.Item || !current.Item.active) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'Resident not found' }) };
    }
    await ddb.send(
      new UpdateCommand({
        TableName: RESIDENTS_TABLE,
        Key: { residentId: id },
        UpdateExpression: 'SET active = :false',
        ExpressionAttributeValues: { ':false': false },
      })
    );
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ deleted: id, kind }) };
  }

  // Volunteer: refuse to remove the last active secretary or joint secretary —
  // otherwise the colony can end up with nobody able to run assignment,
  // reassignments, or escalations.
  const target = await ddb.send(new GetCommand({ TableName: VOLUNTEERS_TABLE, Key: { volunteerId: id } }));
  if (!target.Item || !target.Item.active) {
    return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'Volunteer not found' }) };
  }
  if (['secretary', 'joint_secretary'].includes(target.Item.role)) {
    const all = await ddb.send(new ScanCommand({
      TableName: VOLUNTEERS_TABLE,
      FilterExpression: '#a = :true AND #r IN (:sec, :joint)',
      ExpressionAttributeNames: { '#a': 'active', '#r': 'role' },
      ExpressionAttributeValues: { ':true': true, ':sec': 'secretary', ':joint': 'joint_secretary' },
    }));
    if ((all.Items || []).length <= 1) {
      return {
        statusCode: 409,
        headers: cors(),
        body: JSON.stringify({ error: "Can't remove the last secretary or joint secretary" }),
      };
    }
  }

  // Don't orphan today's pending check-ins: if the volunteer still has an
  // unfinished check-in today, make the secretary reassign it first.
  const today = new Date().toISOString().slice(0, 10);
  const pending = await ddb.send(new ScanCommand({
    TableName: CHECKINS_TABLE,
    FilterExpression: '#d = :today AND assignedVolunteerId = :vid AND #s <> :done',
    ExpressionAttributeNames: { '#d': 'date', '#s': 'status' },
    ExpressionAttributeValues: { ':today': today, ':vid': id, ':done': 'done' },
  }));
  if ((pending.Items || []).length > 0) {
    return {
      statusCode: 409,
      headers: cors(),
      body: JSON.stringify({
        error: `This volunteer still has ${pending.Items.length} unfinished check-in(s) today. Reassign them first.`,
      }),
    };
  }

  await ddb.send(
    new UpdateCommand({
      TableName: VOLUNTEERS_TABLE,
      Key: { volunteerId: id },
      UpdateExpression: 'SET active = :false',
      ExpressionAttributeValues: { ':false': false },
    })
  );
  return { statusCode: 200, headers: cors(), body: JSON.stringify({ deleted: id, kind }) };
};
