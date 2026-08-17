const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const client = new DynamoDBDocumentClient(new DynamoDBClient({}));
const sns = new SNSClient({});

const RESIDENTS_TABLE = process.env.RESIDENTS_TABLE;
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const CHECKINS_TABLE = process.env.CHECKINS_TABLE;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dayName(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' }); // "Mon", "Tue", ...
}

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Simple rotation: pick the volunteer with the fewest assignments so far this week.
function pickVolunteer(volunteers, assignmentCounts) {
  const eligible = volunteers.filter((v) => v.role === 'volunteer' && v.active);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => (assignmentCounts[a.volunteerId] || 0) - (assignmentCounts[b.volunteerId] || 0));
  return eligible[0];
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
  const todayDay = dayName(new Date());

  const [residentsRes, volunteersRes] = await Promise.all([
    client.send(new ScanCommand({ TableName: RESIDENTS_TABLE })),
    client.send(new ScanCommand({ TableName: VOLUNTEERS_TABLE })),
  ]);

  const residents = (residentsRes.Items || []).filter((r) => r.active && r.consentGiven);
  const volunteers = (volunteersRes.Items || []).filter(
    (v) => v.active && (v.availableDays || []).includes(todayDay)
  );

  const assignmentCounts = {};
  const created = [];

  for (const resident of residents) {
    const volunteer = pickVolunteer(volunteers, assignmentCounts);
    if (!volunteer) {
      console.warn(`No available volunteer for resident ${resident.residentId} today`);
      continue;
    }
    assignmentCounts[volunteer.volunteerId] = (assignmentCounts[volunteer.volunteerId] || 0) + 1;

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

  console.log(`Assigned ${created.length} check-ins for ${today}`);
  return { assigned: created.length, checkInIds: created };
};
