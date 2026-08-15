#!/usr/bin/env node
const cdk = require('aws-cdk-lib');
const { CheckinStack } = require('../lib/checkin-stack');

const app = new cdk.App();
new CheckinStack(app, 'NeighborhoodCheckinStack', {
  env: {
    region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
  },
});