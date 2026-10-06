/**
 * Create the local demo user in the Firebase Auth emulator and mark the email verified.
 *
 * Run from the repo root (the Auth emulator must already be listening on 127.0.0.1:9099):
 *   node scripts/seed-demo-user.mjs
 */

const AUTH_EMULATOR_HOST = 'http://127.0.0.1:9099';
const API_KEY = 'fake-api-key';
const EMAIL = 'demo@example.com';
const PASSWORD = 'demo-password';

const endpoint = (method) =>
  `${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=${API_KEY}`;

function errorMessage(data) {
  const message = data?.error?.message;
  return typeof message === 'string' ? message : JSON.stringify(data);
}

function isEmailExists(data) {
  return errorMessage(data).startsWith('EMAIL_EXISTS');
}

async function post(url, body, headers = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
    const detail = cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
    console.error(
      `Auth emulator is not reachable at ${AUTH_EMULATOR_HOST}.\n` +
        'Start it from the repo root, then run this script again:\n' +
        '  npx -y firebase-tools@latest emulators:start --only auth,functions\n' +
        `Details: ${detail}`,
    );
    process.exit(1);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    console.error(`Auth emulator returned a non-JSON response (${response.status}): ${text}`);
    process.exit(1);
  }

  return { ok: response.ok, status: response.status, data };
}

async function main() {
  const signUp = await post(endpoint('signUp'), {
    email: EMAIL,
    password: PASSWORD,
    returnSecureToken: true,
  });

  let localId;
  if (signUp.ok) {
    localId = signUp.data.localId;
    console.log(`Created ${EMAIL}.`);
  } else if (isEmailExists(signUp.data)) {
    const signIn = await post(endpoint('signInWithPassword'), {
      email: EMAIL,
      password: PASSWORD,
      returnSecureToken: true,
    });
    if (!signIn.ok) {
      console.error(`Demo user already exists, but sign-in failed: ${errorMessage(signIn.data)}`);
      process.exit(1);
    }
    localId = signIn.data.localId;
    console.log(`${EMAIL} already exists; leaving the account in place.`);
  } else {
    console.error(`Could not create ${EMAIL}: ${errorMessage(signUp.data)}`);
    process.exit(1);
  }

  if (typeof localId !== 'string' || localId.length === 0) {
    console.error('Auth emulator did not return a localId for the demo user.');
    process.exit(1);
  }

  // emailVerified is an admin field. The emulator treats "Bearer owner" as that credential.
  const update = await post(
    endpoint('update'),
    {
      localId,
      emailVerified: true,
    },
    { Authorization: 'Bearer owner' },
  );

  if (!update.ok || update.data.emailVerified !== true) {
    const detail = update.ok ? JSON.stringify(update.data) : errorMessage(update.data);
    console.error(`Could not set emailVerified for ${EMAIL}: ${detail}`);
    process.exit(1);
  }

  console.log(`${EMAIL} is email-verified in the Auth emulator.`);
}

await main();
