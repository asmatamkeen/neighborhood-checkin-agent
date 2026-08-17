const { Stack, Duration, RemovalPolicy } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const sns = require('aws-cdk-lib/aws-sns');
const events = require('aws-cdk-lib/aws-events');
const targets = require('aws-cdk-lib/aws-events-targets');
const apigw = require('aws-cdk-lib/aws-apigateway');

class CheckinStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // ---------- DynamoDB tables ----------
    const residentsTable = new dynamodb.Table(this, 'ResidentsTable', {
      tableName: 'neighborhood-checkin-residents',
      partitionKey: { name: 'residentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // fine for a hackathon demo project
    });

    const volunteersTable = new dynamodb.Table(this, 'VolunteersTable', {
      tableName: 'neighborhood-checkin-volunteers',
      partitionKey: { name: 'volunteerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const checkInsTable = new dynamodb.Table(this, 'CheckInsTable', {
      tableName: 'neighborhood-checkin-records',
      partitionKey: { name: 'checkInId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ---------- SNS topic for notifications ----------
    const notifyTopic = new sns.Topic(this, 'CheckinNotifyTopic', {
      topicName: 'neighborhood-checkin-notifications',
    });

    // ---------- Lambda: daily assignment ----------
    const assignFn = new lambda.Function(this, 'AssignCheckInsFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'assignCheckIns.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(30),
      environment: {
        RESIDENTS_TABLE: residentsTable.tableName,
        VOLUNTEERS_TABLE: volunteersTable.tableName,
        CHECKINS_TABLE: checkInsTable.tableName,
      },
    });
    residentsTable.grantReadData(assignFn);
    volunteersTable.grantReadData(assignFn);
    checkInsTable.grantWriteData(assignFn);
    // Allow direct-to-phone SMS for sending each day's OTP (separate from the topic-based
    // notifications used elsewhere, since this targets a phone number, not a subscribed topic)
    assignFn.addToRolePolicy(
      new (require('aws-cdk-lib/aws-iam').PolicyStatement)({
        actions: ['sns:Publish'],
        resources: ['*'],
      })
    );

    // ---------- Lambda: escalation agent (Strands Agents SDK, tool-calling loop) ----------
    // This is the "brain" of the system: instead of hardcoded if/else, it's given
    // tools + a policy prompt and reasons through each pending check-in itself.
    // Uses Groq's free, OpenAI-compatible API as the model provider (via Strands' OpenAIModel
    // class) — chosen after hitting an account-level Bedrock activation delay during
    // development; see README for details. Swapping back to Bedrock/Nova/Claude later only
    // requires changing the model construction in escalationAgent.mjs.
    const escalateFn = new lambda.Function(this, 'EscalateCheckInsFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'escalationAgent.handler',
      code: lambda.Code.fromAsset('../backend/agent'),
      timeout: Duration.seconds(90), // LLM tool-calling loop needs more time than a plain DB call
      memorySize: 512,
      environment: {
        RESIDENTS_TABLE: residentsTable.tableName,
        VOLUNTEERS_TABLE: volunteersTable.tableName,
        CHECKINS_TABLE: checkInsTable.tableName,
        NOTIFY_TOPIC_ARN: notifyTopic.topicArn,
        REMINDER_AFTER_MIN: '1',
        SECRETARY_AFTER_MIN: '2',
        JOINT_SEC_AFTER_MIN: '3',
        EMERGENCY_AFTER_MIN: '4',
        GROQ_API_KEY: process.env.GROQ_API_KEY || '',
      },
    });
    residentsTable.grantReadData(escalateFn);
    volunteersTable.grantReadData(escalateFn);
    checkInsTable.grantReadWriteData(escalateFn);
    notifyTopic.grantPublish(escalateFn);

    // ---------- Lambda: mark check-in done (called from frontend, PIN-verified) ----------
    const markDoneFn = new lambda.Function(this, 'MarkCheckInDoneFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'markCheckInDone.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: {
        CHECKINS_TABLE: checkInsTable.tableName,
        VOLUNTEERS_TABLE: volunteersTable.tableName,
      },
    });
    checkInsTable.grantReadWriteData(markDoneFn);
    volunteersTable.grantReadData(markDoneFn);

    // ---------- Lambda: reassign a check-in to a different volunteer (secretary only) ----------
    const reassignFn = new lambda.Function(this, 'ReassignCheckInFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'reassignCheckIn.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: {
        CHECKINS_TABLE: checkInsTable.tableName,
        VOLUNTEERS_TABLE: volunteersTable.tableName,
      },
    });
    checkInsTable.grantReadWriteData(reassignFn);
    volunteersTable.grantReadData(reassignFn);

    // ---------- Lambda: add a new resident (secretary only) ----------
    const addResidentFn = new lambda.Function(this, 'AddResidentFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'addResident.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: {
        RESIDENTS_TABLE: residentsTable.tableName,
        VOLUNTEERS_TABLE: volunteersTable.tableName,
      },
    });
    residentsTable.grantWriteData(addResidentFn);
    volunteersTable.grantReadData(addResidentFn);

    // ---------- Lambda: add a new volunteer/secretary (secretary only) ----------
    const addPersonFn = new lambda.Function(this, 'AddPersonFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'addPerson.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: {
        VOLUNTEERS_TABLE: volunteersTable.tableName,
      },
    });
    volunteersTable.grantReadWriteData(addPersonFn);

    // ---------- EventBridge schedules ----------
    // Every day at 8 AM IST (2:30 UTC): assign check-ins
    new events.Rule(this, 'DailyAssignRule', {
      schedule: events.Schedule.cron({ minute: '30', hour: '2' }),
      targets: [new targets.LambdaFunction(assignFn)],
    });

    // Every 30 minutes: check for overdue check-ins and escalate
    new events.Rule(this, 'EscalationCheckRule', {
      schedule: events.Schedule.rate(Duration.minutes(30)),
      targets: [new targets.LambdaFunction(escalateFn)],
    });

    // ---------- Lambda: get today's check-ins (for frontend dashboard) ----------
    const getCheckInsFn = new lambda.Function(this, 'GetCheckInsFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getCheckIns.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: {
        RESIDENTS_TABLE: residentsTable.tableName,
        VOLUNTEERS_TABLE: volunteersTable.tableName,
        CHECKINS_TABLE: checkInsTable.tableName,
      },
    });
    residentsTable.grantReadData(getCheckInsFn);
    volunteersTable.grantReadData(getCheckInsFn);
    checkInsTable.grantReadData(getCheckInsFn);

    // ---------- Lambda: list people for the "who are you?" picker ----------
    const getPeopleFn = new lambda.Function(this, 'GetPeopleFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getPeople.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: {
        VOLUNTEERS_TABLE: volunteersTable.tableName,
      },
    });
    volunteersTable.grantReadData(getPeopleFn);

    // ---------- API Gateway (for frontend to call markDone) ----------
    const api = new apigw.RestApi(this, 'CheckinApi', {
      restApiName: 'neighborhood-checkin-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
      },
    });
    const checkins = api.root.addResource('checkins');
    checkins.addMethod('GET', new apigw.LambdaIntegration(getCheckInsFn));
    const checkinItem = checkins.addResource('{checkInId}');
    checkinItem.addMethod('POST', new apigw.LambdaIntegration(markDoneFn));
    const reassign = checkinItem.addResource('reassign');
    reassign.addMethod('POST', new apigw.LambdaIntegration(reassignFn));

    // ---------- Lambda: secretary/joint secretary sets their own PIN (first-time only) ----------
    const setAdminPinFn = new lambda.Function(this, 'SetAdminPinFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'setAdminPin.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: {
        VOLUNTEERS_TABLE: volunteersTable.tableName,
      },
    });
    volunteersTable.grantReadWriteData(setAdminPinFn);

    const people = api.root.addResource('people');
    people.addMethod('GET', new apigw.LambdaIntegration(getPeopleFn));
    people.addMethod('POST', new apigw.LambdaIntegration(addPersonFn));
    const personItem = people.addResource('{volunteerId}');
    const setPin = personItem.addResource('set-pin');
    setPin.addMethod('POST', new apigw.LambdaIntegration(setAdminPinFn));

    const residents = api.root.addResource('residents');
    residents.addMethod('POST', new apigw.LambdaIntegration(addResidentFn));

    this.apiUrl = api.url;
  }
}

module.exports = { CheckinStack };
