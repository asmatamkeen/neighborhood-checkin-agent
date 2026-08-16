const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = new DynamoDBDocumentClient(new DynamoDBClient({}));

const RESIDENTS_TABLE = process.env.RESIDENTS_TABLE;
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const CHECKINS_TABLE = process.env.CHECKINS_TABLE;

exports.handler = async () => {
  const today = new Date().toISOString().slice(0, 10);

  const scan = await ddb.send(
    new ScanCommand({
      TableName: CHECKINS_TABLE,
      FilterExpression: '#d = :today',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':today': today },
    })
  );

  const items = scan.Items || [];
  const enriched = [];

  for (const item of items) {
    const [residentRes, volunteerRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: RESIDENTS_TABLE, Key: { residentId: item.residentId } })),
      ddb.send(new GetCommand({ TableName: VOLUNTEERS_TABLE, Key: { volunteerId: item.assignedVolunteerId } })),
    ]);
    const resident = residentRes.Item;
    const volunteer = volunteerRes.Item;
    if (!resident) continue;

    enriched.push({
      checkInId: item.checkInId,
      status: item.status,
      residentName: resident.name,
      residentUnit: resident.unit,
      assignedVolunteerId: item.assignedVolunteerId,
      volunteerName: volunteer ? volunteer.name : 'Unassigned',
      assignedAt: item.assignedAt,
      completedAt: item.completedAt || null,
      escalationLog: item.escalationLog || [],
    });
  }

  // Most recently assigned first
  enriched.sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt));

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ date: today, checkIns: enriched }),
  };
};
