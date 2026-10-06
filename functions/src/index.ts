import { googleAI } from '@genkit-ai/google-genai';
import { hasClaim, onCallGenkit } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { genkit } from 'genkit';
import { defineAnalyzeResumeFlow } from './analyze-resume.js';

const apiKey = defineSecret('GEMINI_API_KEY');

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model('gemini-flash-latest'),
});

const analyzeResumeFlow = defineAnalyzeResumeFlow(ai);

// Deployed checks stay on. Local emulator runs use the Auth emulator and an
// App Check debug token; do not disable authPolicy or enforceAppCheck here.
// Copy functions/.secret.local.example to functions/.secret.local for the emulator.
export const analyzeResume = onCallGenkit(
  {
    secrets: [apiKey],
    authPolicy: hasClaim('email_verified'),
    enforceAppCheck: true,
    timeoutSeconds: 120,
    maxInstances: 2,
    region: 'us-central1',
  },
  analyzeResumeFlow,
);
