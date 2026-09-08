const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const client = new DynamoDBDocumentClient(new DynamoDBClient({}));
const sns = new SNSClient({});

const RESIDENTS_TABLE = process.env.RESIDENTS_TABLE;
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const CHECKINS_TABLE = process.env.CHECKINS_TABLE;

// How far back to look when working out who has been doing the most.
const FAIRNESS_WINDOW_DAYS = 7;

// The daily job runs on AWS, which uses UTC. Residents and volunteers are in
// India, so "what day is it" has to be answered in their local time — otherwise
// an early-morning run would use yesterday's day name and pick the wrong people.
const LOCAL_UTC_OFFSET_MINUTES = 330; // IST = UTC+5:30

function localNow() {
  return new Date(Date.now() + LOCAL_UTC_OFFSET_MINUTES * 60000);
}

function todayISO() {
  return localNow().toISOString().slice(0, 10);
}

function dayName(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function daysAgoISO(n) {
  const d = localNow();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Counts how many check-ins each volunteer has actually been given over the
// past week. Without this the balancing resets every run, so someone who is
// available every weekend can quietly end up doing far more than everyone
// else and nothing corrects for it.
async function getRecentAssignmentCounts() {
  const cutoff = daysAgoISO(FAIRNESS_WINDOW_DAYS);
  const res = await client.send(
    new ScanCommand({
      TableName: CHECKINS_TABLE,
      FilterExpression: '#d >= :cutoff',
      ExpressionAttributeNames: { '#d': 'date' },
      ExpressionAttributeValues: { ':cutoff': cutoff },
    })
  );

  const counts = {};
  for (const item of res.Items || []) {
    if (!item.assignedVolunteerId) continue;
    counts[item.assignedVolunteerId] = (counts[item.assignedVolunteerId] || 0) + 1;
  }
  return counts;
}

// Fewest recent check-ins wins. Ties are broken randomly so the same person
// doesn't always get picked first just because of how the list is ordered.
function pickVolunteer(volunteers, counts) {
  const eligible = volunteers.filter((v) => v.role === 'volunteer' && v.active);
  if (eligible.length === 0) return null;

  let lowest = Infinity;
  for (const v of eligible) {
    const c = counts[v.volunteerId] || 0;
    if (c < lowest) lowest = c;
  }
  const tied = eligible.filter((v) => (counts[v.volunteerId] || 0) === lowest);
  return tied[Math.floor(Math.random() * tied.length)];
}

// Send today's verification code to the resident's own phone if we have one,
// otherwise fall back to their emergency contact. Best-effort: SMS delivery
// issues never block the assignment itself, and the code is always logged
// so a demo/test run can proceed even if a text doesn't arrive.
async function sendOtp(resident, otp) {
  const destination = resident.residentPhone || resident.emergencyContactPhone;
  console.log(`OTP for ${resident.name} (${resident.residentId}): ${otp} -> ${destination}`);
  if (!destination) return;
  try {
    await sns.send(
      new PublishCommand({
        PhoneNumber: destination,
        Message: `Neighborhood Check-In: today's visit code for ${resident.name} is ${otp}. Share it with the volunteer when they visit.`,
      })
    );
  } catch (err) {
    console.warn(`SMS send failed for ${resident.name}, code is still valid and logged above:`, err.message);
  }
}

exports.handler = async () => {
  const today = todayISO();
  const todayDay = dayName(localNow());

  const [residentsRes, volunteersRes, recentCounts] = await Promise.all([
    client.send(new ScanCommand({ TableName: RESIDENTS_TABLE })),
    client.send(new ScanCommand({ TableName: VOLUNTEERS_TABLE })),
    getRecentAssignmentCounts(),
  ]);

  const residents = (residentsRes.Items || []).filter((r) => r.active && r.consentGiven);
  const volunteers = (volunteersRes.Items || []).filter(
    (v) => v.active && (v.availableDays || []).includes(todayDay)
  );

  // Start from real recent history, then keep counting within this run too, so
  // today's residents also get spread out rather than all landing on one person.
  const counts = { ...recentCounts };
  const created = [];

  for (const resident of residents) {
    const volunteer = pickVolunteer(volunteers, counts);
    if (!volunteer) {
      console.warn(`No available volunteer for resident ${resident.residentId} on ${todayDay}`);
      continue;
    }
    counts[volunteer.volunteerId] = (counts[volunteer.volunteerId] || 0) + 1;

    const otp = generateOtp();
    await sendOtp(resident, otp);

    const checkInId = `chk_${today}_${resident.residentId}`;
    const item = {
      checkInId,
      residentId: resident.residentId,
      assignedVolunteerId: volunteer.volunteerId,
      date: today,
      status: 'pending',
      assignedAt: new Date().toISOString(),
      otp,
      escalationLog: [
        { step: 'assigned', volunteerId: volunteer.volunteerId, at: new Date().toISOString() },
      ],
    };

    await client.send(new PutCommand({ TableName: CHECKINS_TABLE, Item: item }));
    created.push(checkInId);
  }

  console.log(
    `Assigned ${created.length} check-ins for ${today} (${todayDay}). ` +
      `Recent 7-day load before this run: ${JSON.stringify(recentCounts)}`
  );
  return { assigned: created.length, checkInIds: created, day: todayDay };
};