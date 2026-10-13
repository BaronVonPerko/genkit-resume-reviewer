import { CustomProvider } from 'firebase/app-check';
import { type FirebaseApp } from 'firebase/app';

const EXCHANGE_ENDPOINT = 'https://content-firebaseappcheck.googleapis.com/v1';
const SCRIPT_READY_MS = 15_000;

interface EnterpriseRecaptcha {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

/**
 * Fraud Defense score keys attest only when enterprise.js is loaded with
 * `?render=<site key>` and `execute()` is called with that same key.
 * `ReCaptchaEnterpriseProvider` loads `?render=explicit` and executes an
 * invisible widget, and App Check rejects that token with 403.
 */
export function createRecaptchaEnterpriseAppCheckProvider(
  app: FirebaseApp,
  siteKey: string,
): CustomProvider {
  return new CustomProvider({
    getToken: async () => {
      const recaptchaToken = await executeRecaptchaEnterprise(siteKey);
      return exchangeRecaptchaEnterpriseToken(app, recaptchaToken);
    },
  });
}

export function appCheckTokenFromExchange(
  body: unknown,
  now = Date.now(),
): { token: string; expireTimeMillis: number } {
  if (!isRecord(body)) {
    throw new Error('App Check token exchange returned an unusable response.');
  }
  const token = body['token'];
  const ttl = body['ttl'];
  const seconds = typeof ttl === 'string' ? Number(/^([\d.]+)s$/.exec(ttl)?.[1]) : Number.NaN;
  if (typeof token !== 'string' || token.length === 0 || !Number.isFinite(seconds)) {
    throw new Error('App Check token exchange returned an unusable response.');
  }
  return { token, expireTimeMillis: now + seconds * 1000 };
}

let enterpriseScript: Promise<void> | null = null;

async function executeRecaptchaEnterprise(siteKey: string): Promise<string> {
  await loadEnterpriseScript(siteKey);
  const enterprise = await waitForEnterprise();
  return enterprise.execute(siteKey, { action: 'fire_app_check' });
}

function loadEnterpriseScript(siteKey: string): Promise<void> {
  enterpriseScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      enterpriseScript = null;
      reject(new Error('reCAPTCHA Enterprise failed to load.'));
    };
    document.head.appendChild(script);
  });
  return enterpriseScript;
}

function waitForEnterprise(): Promise<EnterpriseRecaptcha> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const enterprise = readEnterprise();
      if (enterprise) {
        enterprise.ready(() => resolve(enterprise));
        return;
      }
      if (Date.now() - started > SCRIPT_READY_MS) {
        reject(new Error('reCAPTCHA Enterprise did not become ready.'));
        return;
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}

function readEnterprise(): EnterpriseRecaptcha | null {
  const candidate = window as Window & { grecaptcha?: { enterprise?: EnterpriseRecaptcha } };
  const enterprise = candidate.grecaptcha?.enterprise;
  if (!enterprise?.ready || !enterprise.execute) {
    return null;
  }
  return enterprise;
}

async function exchangeRecaptchaEnterpriseToken(
  app: FirebaseApp,
  recaptchaToken: string,
): Promise<{ token: string; expireTimeMillis: number }> {
  const { apiKey, appId, projectId } = app.options;
  if (!apiKey || !appId || !projectId) {
    throw new Error('App Check needs the Firebase apiKey, appId, and projectId.');
  }
  const response = await fetch(
    `${EXCHANGE_ENDPOINT}/projects/${projectId}/apps/${appId}:exchangeRecaptchaEnterpriseToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recaptcha_enterprise_token: recaptchaToken }),
      signal: AbortSignal.timeout(SCRIPT_READY_MS),
    },
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = readErrorMessage(body);
    throw new Error(message ?? `App Check token exchange failed (${response.status}).`);
  }
  return appCheckTokenFromExchange(body);
}

function readErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const error = body['error'];
  if (!isRecord(error)) {
    return null;
  }
  const message = error['message'];
  return typeof message === 'string' ? message : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
