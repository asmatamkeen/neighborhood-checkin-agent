const { Stack, Duration, RemovalPolicy, CfnOutput } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const sns = require('aws-cdk-lib/aws-sns');
const events = require('aws-cdk-lib/aws-events');
const targets = require('aws-cdk-lib/aws-events-targets');
const apigw = require('aws-cdk-lib/aws-apigateway');
const cognito = require('aws-cdk-lib/aws-cognito');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const iam = require('aws-cdk-lib/aws-iam');

class CheckinStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // ---------- DynamoDB tables ----------
    const residentsTable = new dynamodb.Table(this, 'ResidentsTable', {
      tableName: 'neighborhood-checkin-residents',
      partitionKey: { name: 'residentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // real resident data must never be wiped by a deploy
      pointInTimeRecovery: true,
    });

    const volunteersTable = new dynamodb.Table(this, 'VolunteersTable', {
      tableName: 'neighborhood-checkin-volunteers',
      partitionKey: { name: 'volunteerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    const checkInsTable = new dynamodb.Table(this, 'CheckInsTable', {
      tableName: 'neighborhood-checkin-records',
      partitionKey: { name: 'checkInId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Tracks failed sign-in attempts so we can apply a short temporary lockout.
    // Safe to destroy on teardown — this holds no real user data, only counters,
    // and rows expire automatically after a day.
    const attemptsTable = new dynamodb.Table(this, 'SignInAttemptsTable', {
      tableName: 'neighborhood-checkin-signin-attempts',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ---------- SNS topic for notifications ----------
    const notifyTopic = new sns.Topic(this, 'CheckinNotifyTopic', {
      topicName: 'neighborhood-checkin-notifications',
    });

    // ---------- Cognito: real accounts (email + password) ----------
    // PreSignUp trigger auto-confirms accounts (demo data has no real inboxes to
    // verify) and refuses sign-up unless the email was already registered by the
    // secretary — that's what stops a stranger from signing up as someone else.
    const preSignUpFn = new lambda.Function(this, 'PreSignUpFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'preSignUp.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: { VOLUNTEERS_TABLE: volunteersTable.tableName },
    });
    volunteersTable.grantReadData(preSignUpFn);

    const userPool = new cognito.UserPool(this, 'CheckinUserPool', {
      userPoolName: 'neighborhood-checkin-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true }, // Cognito sends a real verification code on sign-up
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
      },
      lambdaTriggers: { preSignUp: preSignUpFn },
      removalPolicy: RemovalPolicy.RETAIN, // real accounts must survive a stack teardown
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'CheckinUserPoolClient', {
      userPool,
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false, // this is a browser app, not a confidential backend client
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CheckinApiAuthorizer', {
      cognitoUserPools: [userPool],
    });
    const authOptions = { authorizer, authorizationType: apigw.AuthorizationType.COGNITO };

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
    // Needs read as well as write: the fairness logic counts each volunteer's
    // recent assignments before deciding who to pick next.
    checkInsTable.grantReadWriteData(assignFn);
    assignFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['sns:Publish'], resources: ['*'] })
    );

    // ---------- Lambda: escalation agent (Strands Agents SDK, tool-calling loop) ----------
    const escalateFn = new lambda.Function(this, 'EscalateCheckInsFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'escalationAgent.handler',
      code: lambda.Code.fromAsset('../backend/agent'),
      timeout: Duration.seconds(90),
      memorySize: 512,
      environment: {
        RESIDENTS_TABLE: residentsTable.tableName,
        VOLUNTEERS_TABLE: volunteersTable.tableName,
        CHECKINS_TABLE: checkInsTable.tableName,
        NOTIFY_TOPIC_ARN: notifyTopic.topicArn,
        // Realistic escalation policy, in minutes since assignment.
        // 60 min: reminder to the volunteer
        // 180 min (3 hrs): escalate to secretary
        // 300 min (5 hrs): escalate to joint secretary
        // 420 min (7 hrs): escalate to emergency contact
        // For a live demo, these can be temporarily lowered (e.g. 1/2/3/4) so the
        // whole chain can be watched within a few minutes — see README.
        REMINDER_AFTER_MIN: '60',
        SECRETARY_AFTER_MIN: '180',
        JOINT_SEC_AFTER_MIN: '300',
        EMERGENCY_AFTER_MIN: '420',
        GROQ_API_KEY: process.env.GROQ_API_KEY || '',
      },
    });
    residentsTable.grantReadData(escalateFn);
    volunteersTable.grantReadData(escalateFn);
    checkInsTable.grantReadWriteData(escalateFn);
    notifyTopic.grantPublish(escalateFn);

    // ---------- Lambda: mark check-in done (OTP-verified — unrelated to login) ----------
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

    // ---------- Lambda: reassign a check-in (secretary/joint secretary only) ----------
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

    // ---------- Lambda: add a new resident (secretary/joint secretary only) ----------
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

    // ---------- Lambda: add a new volunteer/secretary (secretary/joint secretary only) ----------
    const addPersonFn = new lambda.Function(this, 'AddPersonFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'addPerson.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: { VOLUNTEERS_TABLE: volunteersTable.tableName },
    });
    volunteersTable.grantReadWriteData(addPersonFn);

    // ---------- Lambda: get today's check-ins (role-filtered server-side) ----------
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

    // ---------- Lambda: list people (for the reassign dropdown) ----------
    const getPeopleFn = new lambda.Function(this, 'GetPeopleFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getPeople.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: { VOLUNTEERS_TABLE: volunteersTable.tableName },
    });
    volunteersTable.grantReadData(getPeopleFn);

    // ---------- Lambda: "who am I" — profile lookup for the logged-in user ----------
    const getMyProfileFn = new lambda.Function(this, 'GetMyProfileFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getMyProfile.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: { VOLUNTEERS_TABLE: volunteersTable.tableName },
    });
    volunteersTable.grantReadData(getMyProfileFn);

    // ---------- Lambda: secretary manually triggers today's assignment on demand ----------
    const runAssignmentNowFn = new lambda.Function(this, 'RunAssignmentNowFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'runAssignmentNow.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(30),
      environment: {
        VOLUNTEERS_TABLE: volunteersTable.tableName,
        ASSIGN_FN_NAME: assignFn.functionName,
      },
    });
    volunteersTable.grantReadData(runAssignmentNowFn);
    assignFn.grantInvoke(runAssignmentNowFn);

    // ---------- EventBridge schedules ----------
    new events.Rule(this, 'DailyAssignRule', {
      schedule: events.Schedule.cron({ minute: '30', hour: '2' }),
      targets: [new targets.LambdaFunction(assignFn)],
    });
    new events.Rule(this, 'EscalationCheckRule', {
      schedule: events.Schedule.rate(Duration.minutes(30)),
      targets: [new targets.LambdaFunction(escalateFn)],
    });

    // ---------- API Gateway — every route below requires a valid Cognito login ----------
    const api = new apigw.RestApi(this, 'CheckinApi', {
      restApiName: 'neighborhood-checkin-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
      },
    });

    const checkins = api.root.addResource('checkins');
    checkins.addMethod('GET', new apigw.LambdaIntegration(getCheckInsFn), authOptions);
    const checkinItem = checkins.addResource('{checkInId}');
    checkinItem.addMethod('POST', new apigw.LambdaIntegration(markDoneFn), authOptions);
    const reassign = checkinItem.addResource('reassign');
    reassign.addMethod('POST', new apigw.LambdaIntegration(reassignFn), authOptions);

    const people = api.root.addResource('people');
    people.addMethod('GET', new apigw.LambdaIntegration(getPeopleFn), authOptions);
    people.addMethod('POST', new apigw.LambdaIntegration(addPersonFn), authOptions);

    const me = api.root.addResource('me');
    me.addMethod('GET', new apigw.LambdaIntegration(getMyProfileFn), authOptions);

    // ---------- Lambda: failed sign-in attempt tracking ----------
    const signInAttemptsFn = new lambda.Function(this, 'SignInAttemptsFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'signInAttempts.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: { ATTEMPTS_TABLE: attemptsTable.tableName },
    });
    attemptsTable.grantReadWriteData(signInAttemptsFn);

    const residents = api.root.addResource('residents');
    residents.addMethod('POST', new apigw.LambdaIntegration(addResidentFn), authOptions);

    // Deliberately NOT behind the Cognito authorizer — this has to work before
    // anyone is signed in, since its whole job is guarding the sign-in itself.
    const signInAttempts = api.root.addResource('signin-attempts');
    signInAttempts.addMethod('POST', new apigw.LambdaIntegration(signInAttemptsFn));

    const runAssignment = api.root.addResource('run-assignment');
    runAssignment.addMethod('POST', new apigw.LambdaIntegration(runAssignmentNowFn), authOptions);

    this.apiUrl = api.url;

    // ---------- Failure alarms ----------
    // Both scheduled jobs have failed silently during development — once from a
    // missing API key, once from a missing table permission — and in both cases
    // it went unnoticed for many hours. For a system whose whole purpose is
    // noticing when someone hasn't been checked on, a job that dies quietly is
    // the worst failure mode there is. These alarms email a real person instead.
    const alertTopic = new sns.Topic(this, 'OpsAlertTopic', {
      topicName: 'neighborhood-checkin-ops-alerts',
      displayName: 'Neighborhood Check-In alerts',
    });

    // Set OPS_ALERT_EMAIL before deploying to receive these. AWS sends a
    // confirmation link to that address once; the subscription is inactive
    // until it's clicked.
    const alertEmail = process.env.OPS_ALERT_EMAIL;
    if (alertEmail) {
      alertTopic.addSubscription(
        new (require('aws-cdk-lib/aws-sns-subscriptions').EmailSubscription)(alertEmail)
      );
    }

    const alarmAction = new (require('aws-cdk-lib/aws-cloudwatch-actions').SnsAction)(alertTopic);

    // The daily assignment job runs once a day, so a single failure matters —
    // it means nobody got assigned to anyone today.
    const assignAlarm = new cloudwatch.Alarm(this, 'AssignCheckInsFailureAlarm', {
      alarmName: 'neighborhood-checkin-assignment-failed',
      alarmDescription:
        "The daily check-in assignment job failed. No one has been assigned to check on residents today.",
      metric: assignFn.metricErrors({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    assignAlarm.addAlarmAction(alarmAction);

    // The escalation agent runs every 30 minutes. Two failures in a row means
    // roughly an hour where a missed check-in wouldn't escalate to anyone.
    const escalateAlarm = new cloudwatch.Alarm(this, 'EscalateCheckInsFailureAlarm', {
      alarmName: 'neighborhood-checkin-escalation-failed',
      alarmDescription:
        'The escalation agent is failing. Missed check-ins are not being escalated to the secretary or emergency contacts.',
      metric: escalateFn.metricErrors({ period: Duration.minutes(30) }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    escalateAlarm.addAlarmAction(alarmAction);

    // A quieter but equally dangerous failure: the assignment job "succeeds"
    // but assigns nobody, so the dashboard is simply empty and nothing looks
    // broken. Alarms if the job hasn't run at all in over a day.
    const assignSilentAlarm = new cloudwatch.Alarm(this, 'AssignCheckInsMissingAlarm', {
      alarmName: 'neighborhood-checkin-assignment-did-not-run',
      alarmDescription: "The daily assignment job hasn't run in over 24 hours.",
      metric: assignFn.metricInvocations({ period: Duration.hours(25) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    assignSilentAlarm.addAlarmAction(alarmAction);

    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}

module.exports = { CheckinStack };