// Run this once to populate your DynamoDB tables with realistic mock data
// for demoing the Neighborhood Safety Check-In Agent.
//
// Usage: node seed.js

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBDocumentClient(new DynamoDBClient({}));

const RESIDENTS_TABLE = 'neighborhood-checkin-residents';
const VOLUNTEERS_TABLE = 'neighborhood-checkin-volunteers';

const residents = [
  {
    residentId: 'res_001',
    name: 'Lakshmi Rao',
    unit: 'House 12, Green Park Colony',
    preferredTime: '18:00',
    preferredMethod: 'visit',
    notes: 'Prefers evening visits, hard of hearing',
    residentPhone: '', // no personal phone on file — OTP goes to emergency contact
    emergencyContactName: 'Suresh Rao (son)',
    emergencyContactPhone: '+919000000001',
    consentGiven: true,
    active: true,
  },
  {
    residentId: 'res_002',
    name: 'Krishna Murthy',
    unit: 'Flat 3B, Sunrise Apartments',
    preferredTime: '17:30',
    preferredMethod: 'call',
    notes: 'Lives alone, diabetic',
    residentPhone: '+919000000032', // has his own phone
    emergencyContactName: 'Anitha Murthy (daughter)',
    emergencyContactPhone: '+919000000002',
    consentGiven: true,
    active: true,
  },
  {
    residentId: 'res_003',
    name: 'Fatima Begum',
    unit: 'House 7, Green Park Colony',
    preferredTime: '19:00',
    preferredMethod: 'visit',
    notes: 'Uses a walker',
    residentPhone: '',
    emergencyContactName: 'Imran Sheikh (nephew)',
    emergencyContactPhone: '+919000000003',
    consentGiven: true,
    active: true,
  },
];

const volunteers = [
  {
    volunteerId: 'vol_001',
    name: 'Ravi Kumar',
    phone: '+919000000011',
    email: 'ravi@example.com',
    availableDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    role: 'volunteer',
    active: true,
  },
  {
    volunteerId: 'vol_002',
    name: 'Priya Nair',
    phone: '+919000000012',
    email: 'priya@example.com',
    availableDays: ['Mon', 'Wed', 'Fri', 'Sat', 'Sun'],
    role: 'volunteer',
    active: true,
  },
  {
    volunteerId: 'vol_003',
    name: 'Arjun Reddy',
    phone: '+919000000013',
    email: 'arjun@example.com',
    availableDays: ['Tue', 'Thu', 'Sat', 'Sun'],
    role: 'volunteer',
    active: true,
  },
  {
    volunteerId: 'sec_001',
    name: 'Meena Iyer',
    phone: '+919000000021',
    email: 'meena.secretary@example.com',
    availableDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    role: 'secretary',
    // no adminPin yet — she sets her own the first time she opens the dashboard
    active: true,
  },
  {
    volunteerId: 'jsec_001',
    name: 'Deepak Sharma',
    phone: '+919000000022',
    email: 'deepak.jointsecretary@example.com',
    availableDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    role: 'joint_secretary',
    // no adminPin yet — he sets his own the first time he opens the dashboard
    active: true,
  },
];

async function seed() {
  console.log('Seeding residents...');
  for (const r of residents) {
    await client.send(new PutCommand({ TableName: RESIDENTS_TABLE, Item: r }));
    console.log(`  added ${r.name}`);
  }

  console.log('Seeding volunteers/secretary/joint secretary...');
  for (const v of volunteers) {
    await client.send(new PutCommand({ TableName: VOLUNTEERS_TABLE, Item: v }));
    console.log(`  added ${v.name} (${v.role})`);
  }

  console.log('Done. 3 residents, 3 volunteers, 1 secretary, 1 joint secretary seeded.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
