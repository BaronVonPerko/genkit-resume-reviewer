import { Service, signal } from '@angular/core';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from 'firebase/app-check';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  type Functions,
} from 'firebase/functions';
import { environment } from '../environments/environment';
import {
  type AnalyzeResumeChunk,
  type AnalyzeResumeInput,
  type ResumeReview,
  type ReviewStatus,
  type ReviewStep,
} from './resume-review';

const DEMO_USER_EMAIL = 'demo@example.com';
const DEMO_USER_PASSWORD = 'demo-password';
const DEMO_USER_MISSING =
  'Demo user is missing. Run node scripts/seed-demo-user.mjs while the Auth emulator is running.';
const DEMO_APP_CHECK_TOKEN = 'demo-app-check-debug-token';

@Service()
export class ResumeReviewService {
  private readonly statusState = signal<ReviewStatus>('idle');
  private readonly resultState = signal<ResumeReview | null>(null);
  private readonly errorMessageState = signal<string | null>(null);
  private readonly authReadyState = signal(!environment.useEmulators);
  private readonly authErrorState = signal<string | null>(null);

  readonly status = this.statusState.asReadonly();
  readonly result = this.resultState.asReadonly();
  readonly errorMessage = this.errorMessageState.asReadonly();
  readonly authReady = this.authReadyState.asReadonly();
  readonly authError = this.authErrorState.asReadonly();

  private functions: Functions | null = null;
  private reviewing = false;
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.initialize();
  }

  async review(resumeText: string): Promise<void> {
    if (this.reviewing) {
      return;
    }
    this.reviewing = true;
    this.resultState.set(null);
    this.errorMessageState.set(null);
    this.statusState.set('parsing_structure');
    try {
      await this.ready;
      const functions = this.functions;
      if (!functions) {
        throw new Error('Firebase Functions is unavailable.');
      }
      const callable = httpsCallable<AnalyzeResumeInput, ResumeReview, AnalyzeResumeChunk>(
        functions,
        'analyzeResume',
      );
      const { stream, data } = await callable.stream({
        resumeText: resumeText.trim(),
      });
      for await (const chunk of stream) {
        const status = readChunkStatus(chunk);
        if (status) {
          this.statusState.set(status);
        }
      }
      this.resultState.set(await data);
      this.statusState.set('complete');
    } catch (error: unknown) {
      this.resultState.set(null);
      this.errorMessageState.set(reviewErrorMessage(error));
      this.statusState.set('error');
    } finally {
      this.reviewing = false;
    }
  }

  private async initialize(): Promise<void> {
    try {
      const app = getApps().length > 0 ? getApp() : initializeApp(environment.firebase);
      this.installAppCheck(app);
      const functions = getFunctions(app, 'us-central1');
      this.functions = functions;
      if (!environment.useEmulators) {
        this.authReadyState.set(true);
        return;
      }
      const auth = getAuth(app);
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      try {
        await signInWithEmailAndPassword(auth, DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
        this.authReadyState.set(true);
      } catch {
        this.authErrorState.set(DEMO_USER_MISSING);
      }
    } catch {
      this.authErrorState.set('The review failed. Try again.');
    }
  }

  private installAppCheck(app: FirebaseApp): void {
    if (environment.useEmulators) {
      initializeAppCheck(app, {
        provider: new CustomProvider({
          getToken: () =>
            Promise.resolve({
              token: DEMO_APP_CHECK_TOKEN,
              expireTimeMillis: Date.now() + 60 * 60 * 1000,
            }),
        }),
        isTokenAutoRefreshEnabled: true,
      });
      return;
    }
    if (environment.appCheckSiteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(environment.appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
      return;
    }
    // The reCAPTCHA Enterprise site key is required at deploy time.
  }
}

function readChunkStatus(chunk: unknown): ReviewStep | null {
  const value =
    typeof chunk === 'string'
      ? chunk
      : chunk && typeof chunk === 'object' && 'status' in chunk
        ? chunk.status
        : null;
  if (
    value === 'parsing_structure' ||
    value === 'analyzing_impact' ||
    value === 'generating_tips'
  ) {
    return value;
  }
  return null;
}

function reviewErrorMessage(error: unknown): string {
  const code = firebaseErrorCode(error);
  if (code.includes('resource-exhausted')) {
    return 'The rate limit is 5 reviews every 10 minutes.';
  }
  if (code.includes('invalid-argument')) {
    return 'The resume must be between 200 and 12,000 characters.';
  }
  return 'The review failed. Try again.';
}

function firebaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : '';
  }
  return '';
}
