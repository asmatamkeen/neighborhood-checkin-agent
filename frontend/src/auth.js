import { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserAttribute } from 'amazon-cognito-identity-js';

// Fill these in after `cdk deploy` — they're printed as CfnOutputs
// (UserPoolId and UserPoolClientId) at the end of the deploy output.
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || 'ap-south-1_kXQRUEeao';
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '6frahbu6hqdah34ninnstlf9l4';

const pool = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID });

export function signUp(email, password) {
  return new Promise((resolve, reject) => {
    const attributes = [new CognitoUserAttribute({ Name: 'email', Value: email })];
    pool.signUp(email, password, attributes, null, (err, result) => {
      if (err) {
        // The PreSignUp Lambda throws a specific message when the email isn't
        // pre-registered by the secretary — surface that clearly if present.
        reject(new Error(err.message || 'Sign up failed'));
        return;
      }
      resolve(result);
    });
  });
}

export function confirmSignUp(email, code) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: pool });
    user.confirmRegistration(code, true, (err, result) => {
      if (err) {
        reject(new Error(err.message || 'That code is incorrect or has expired'));
        return;
      }
      resolve(result);
    });
  });
}

export function resendCode(email) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: pool });
    user.resendConfirmationCode((err, result) => {
      if (err) {
        reject(new Error(err.message || 'Could not resend the code'));
        return;
      }
      resolve(result);
    });
  });
}

export function signIn(email, password) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: pool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: (err) => reject(new Error(err.message || 'Sign in failed')),
    });
  });
}

export function signOut() {
  const user = pool.getCurrentUser();
  if (user) user.signOut();
}

// Returns a valid ID token for the current session, refreshing it if needed,
// or null if nobody is signed in. Every API call uses this to prove identity.
export function getCurrentIdToken() {
  return new Promise((resolve) => {
    const user = pool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(session.getIdToken().getJwtToken());
    });
  });
}
