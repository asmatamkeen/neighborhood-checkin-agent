const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { getCallerProfile } = require('./authHelper');

const lambda = new LambdaClient({});
const VOLUNTEERS_TABLE = process.env.VOLUNTEERS_TABLE;
const ESCALATE_FN_NAME = process.env.ESCALATE_FN_NAME;

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

// Lets the secretary run the escalation agent on demand — same idea as
// run-assignment. Invoked as a fire-and-forget Event: the agent can take a
// couple of minutes (7 check-ins × LLM round-trips), which is far beyond
// API Gateway's ~29s response limit, so we trigger it and let the dashboard
// poll (it refreshes every 30s) show the results as they land.
exports.handler = async (event) => {
  const caller = await getCallerProfile(event, VOLUNTEERS_TABLE);
  const isAuthorized = caller && ['secretary', 'joint_secretary'].includes(caller.role);
  if (!isAuthorized) {
    return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: 'Not authorized to run escalation' }) };
  }

  await lambda.send(
    new InvokeCommand({
      FunctionName: ESCALATE_FN_NAME,
      InvocationType: 'Event', // async — don't wait for the agent to finish
    })
  );

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      triggeredBy: caller.name,
      summary: 'Escalation agent started — check-ins will update within a minute or two.',
    }),
  };
};
