import { googleAI } from '@genkit-ai/google-genai';
import { HttpsError } from 'firebase-functions/https';
import { type ActionContext, type Genkit, z } from 'genkit';
import { enforceReviewRateLimit } from './rate-limit.js';

export const analyzeResumeInputSchema = z.object({
  resumeText: z.string().trim().min(200).max(12000),
});

export const analyzeResumeStreamSchema = z.object({
  status: z.enum(['parsing_structure', 'analyzing_impact', 'generating_tips']),
});

export const analyzeResumeOutputSchema = z.object({
  atsScore: z.number().int().min(0).max(100),
  formattingReview: z.string(),
  impactReview: z.string(),
  actionableTips: z.array(z.string().min(1)).min(3).max(5),
});

const resumeReviewModel = googleAI.model('gemini-flash-latest');

const reviewRules =
  'You are reviewing a resume. Stay specific to the text you were given. Do not invent employers, dates, or metrics that are not in the resume.';

function signedInUid(context: ActionContext | undefined): string | undefined {
  const uid = context?.auth?.['uid'];
  return typeof uid === 'string' && uid.length > 0 ? uid : undefined;
}

/**
 * Registers the resume-review prompts and the analyzeResume flow.
 * Production passes a Genkit instance configured with the Google AI plugin.
 */
export function defineAnalyzeResumeFlow(ai: Genkit) {
  const parseResumeStructure = ai.definePrompt({
    name: 'parseResumeStructure',
    description: 'Notes layout, section order, and ATS-friendliness.',
    model: resumeReviewModel,
    input: {
      schema: z.object({
        resumeText: z.string(),
      }),
    },
    system: reviewRules,
    prompt: `Read the resume and write plain-text notes on its layout, section order, and applicant tracking system friendliness. Mention only structure that is visible in the resume. Do not return JSON.

Resume:
{{resumeText}}`,
  });

  const analyzeResumeImpact = ai.definePrompt({
    name: 'analyzeResumeImpact',
    description: 'Notes action verbs and quantified results.',
    model: resumeReviewModel,
    input: {
      schema: z.object({
        resumeText: z.string(),
      }),
    },
    system: reviewRules,
    prompt: `Read the resume and write plain-text notes on its action verbs and quantified results. Cite only results that appear in the resume. Do not return JSON.

Resume:
{{resumeText}}`,
  });

  const generateResumeTips = ai.definePrompt({
    name: 'generateResumeTips',
    description: 'Turns formatting and impact notes into the structured review.',
    model: resumeReviewModel,
    input: {
      schema: z.object({
        formattingNotes: z.string(),
        impactNotes: z.string(),
      }),
    },
    output: {
      schema: analyzeResumeOutputSchema,
    },
    system: reviewRules,
    prompt: `Using only the notes below, write the final resume review. Stay specific to those notes. Do not invent employers, dates, or metrics that are not in the resume.

Formatting notes:
{{formattingNotes}}

Impact notes:
{{impactNotes}}`,
  });

  // Developer UI and `genkit flow:run` payload: shared/analyze-resume.sample.json
  return ai.defineFlow(
    {
      name: 'analyzeResume',
      inputSchema: analyzeResumeInputSchema,
      streamSchema: analyzeResumeStreamSchema,
      outputSchema: analyzeResumeOutputSchema,
    },
    async (input, side) => {
      // Genkit validates input as JSON Schema before this handler, which keeps
      // minLength/maxLength but does not apply Zod's trim. Parse again so the
      // model sees trimmed text, and reject a trimmed length outside 200–12000
      // before any model call.
      const parsed = analyzeResumeInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new HttpsError(
          'invalid-argument',
          'resumeText must be between 200 and 12000 characters after trimming.',
        );
      }
      const { resumeText } = parsed.data;

      // onCallGenkit copies callable auth onto the flow context. Developer UI
      // and `genkit flow:run` omit it, so those runs are not rate limited.
      const uid = signedInUid(side.context);
      if (uid) {
        enforceReviewRateLimit(uid);
      }

      side.sendChunk({ status: 'parsing_structure' });
      const structure = await parseResumeStructure({ resumeText });

      side.sendChunk({ status: 'analyzing_impact' });
      const impact = await analyzeResumeImpact({ resumeText });

      side.sendChunk({ status: 'generating_tips' });
      const review = await generateResumeTips({
        formattingNotes: structure.text,
        impactNotes: impact.text,
      });
      if (review.output == null) {
        throw new HttpsError('internal', 'The model did not return a resume review.');
      }
      return review.output;
    },
  );
}
