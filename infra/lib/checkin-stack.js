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

    // ---------- Lambda: escalation checker (the agent's core loop) ----------
    const escalateFn = new lambda.Function(this, 'EscalateCheckInsFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'escalateCheckIns.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(30),
      environment: {
        RESIDENTS_TABLE: residentsTable.tableName,
        VOLUNTEERS_TABLE: volunteersTable.tableName,
        CHECKINS_TABLE: checkInsTable.tableName,
        NOTIFY_TOPIC_ARN: notifyTopic.topicArn,
      },
    });
    residentsTable.grantReadData(escalateFn);
    volunteersTable.grantReadData(escalateFn);
    checkInsTable.grantReadWriteData(escalateFn);
    notifyTopic.grantPublish(escalateFn);

    // ---------- Lambda: mark check-in done (called from frontend) ----------
    const markDoneFn = new lambda.Function(this, 'MarkCheckInDoneFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'markCheckInDone.handler',
      code: lambda.Code.fromAsset('../backend/lambdas'),
      timeout: Duration.seconds(15),
      environment: {
        CHECKINS_TABLE: checkInsTable.tableName,
      },
    });
    checkInsTable.grantReadWriteData(markDoneFn);

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

    // ---------- API Gateway (for frontend to call markDone) ----------
    const api = new apigw.RestApi(this, 'CheckinApi', {
      restApiName: 'neighborhood-checkin-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
      },
    });
    const checkins = api.root.addResource('checkins');
    const checkinItem = checkins.addResource('{checkInId}');
    checkinItem.addMethod('POST', new apigw.LambdaIntegration(markDoneFn));

    this.apiUrl = api.url;
  }
}

module.exports = { CheckinStack };
