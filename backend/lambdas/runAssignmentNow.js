const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { getCallerProfile } = require('./authHelper');

const lambda = new LambdaClient({});
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const ASSIGN_FN_NAME = process.env.ASSIGN_FN_NAME;

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

// Lets the secretary run the daily assignment job on demand — useful right
// after adding a new resident, instead of waiting for the 2:30 AM schedule.
// This calls the real AssignCheckInsFn directly rather than duplicating its
// logic, so there's one source of truth for how assignment works.
exports.handler = async (event) => {
  const caller = await getCallerProfile(event, VOLUNTEERS_TABLE);
  const isAuthorized = caller && ['secretary', 'joint_secretary'].includes(caller.role);
  if (!isAuthorized) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: 'Not authorized to run assignment' }) };
  }

  const result = await lambda.send(
    new InvokeCommand({
      FunctionName: ASSIGN_FN_NAME,
      InvocationType: 'RequestResponse',
    })
  );

  const payload = JSON.parse(Buffer.from(result.Payload).toString());

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({ triggeredBy: caller.name, ...payload }),
  };
};
