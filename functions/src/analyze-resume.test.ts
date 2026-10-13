import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { googleAI } from '@genkit-ai/google-genai';
import { HttpsError } from 'firebase-functions/https';
import { genkit, type GenerateRequest } from 'genkit';
import { mockModel } from 'genkit/testing';
import { defineAnalyzeResumeFlow } from './analyze-resume.js';
import { resetReviewRateLimit } from './rate-limit.js';

const TEN_MINUTES_MS = 10 * 60 * 1000;

const SAMPLE_REVIEW = {
  atsScore: 84,
  formattingReview: 'The section order is a single column an ATS can scan.',
  impactReview: 'Bullets use action verbs and include counts from the resume.',
  actionableTips: [
    'Lead the summary with the target role.',
    'Keep each bullet to one outcome.',
    'Spell out acronyms the first time they appear.',
  ],
};

const ai = genkit({});
const model = mockModel(ai, {
  name: googleAI.model('gemini-flash-latest').name,
  respond: () => {
    throw new Error('model invoked');
  },
});
const flow = defineAnalyzeResumeFlow(ai);

function reviewResponse(request: GenerateRequest): string | { text: string } {
  if (request.output?.schema) {
    return { text: JSON.stringify(SAMPLE_REVIEW) };
  }
  const rendered = JSON.stringify(request.messages);
  if (rendered.includes('applicant tracking system')) {
    return 'Layout note: one column with standard section headings.';
  }
  if (rendered.includes('action verbs')) {
    return 'Impact note: bullets use verbs and numbers present in the resume.';
  }
  throw new Error('unexpected prompt');
}

function resume(length: number, character = 'x'): string {
  return character.repeat(length);
}

describe('analyzeResume', { concurrency: false }, () => {
  beforeEach(() => {
    model.reset();
    resetReviewRateLimit();
  });

  test('rejects short, long, and trimmed-too-short resumes before the model', async () => {
    const samples = [
      resume(199),
      resume(12001),
      `   ${resume(199)}`,
      `${resume(199)}\n\n`,
      '',
    ];
    for (const resumeText of samples) {
      await assert.rejects(() => flow({ resumeText }));
      assert.equal(model.requestCount, 0);
    }
    await assert.rejects(() => flow({} as { resumeText: string }));
    assert.equal(model.requestCount, 0);
  });

  test('trims surrounding whitespace and still reviews a 200 character resume', async () => {
    model.respondWith(reviewResponse);
    const body = resume(200, 'Q');
    const result = await flow({ resumeText: `  ${body}  ` });
    assert.equal(result.atsScore, SAMPLE_REVIEW.atsScore);
    assert.equal(model.requestCount, 3);
    const rendered = model.requests.map((request) => JSON.stringify(request.messages));
    assert.equal(rendered[0]?.includes(body), true);
    assert.equal(rendered[0]?.includes(`  ${body}`), false);
    assert.equal(rendered[1]?.includes(body), true);
    assert.equal(rendered[2]?.includes(body), false);
  });

  test('accepts 12000 characters and rejects 12001 before the model', async () => {
    model.respondWith(reviewResponse);
    await flow({ resumeText: resume(12000) });
    assert.equal(model.requestCount, 3);
    model.reset();
    model.respondWith(reviewResponse);
    await assert.rejects(() => flow({ resumeText: resume(12001) }));
    assert.equal(model.requestCount, 0);
  });

  test('streams the three statuses in order and returns the review', async () => {
    model.respondWith(reviewResponse);
    const { stream, output } = flow.stream({ resumeText: resume(240) });
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const result = await output;
    assert.deepEqual(chunks, [
      { status: 'parsing_structure' },
      { status: 'analyzing_impact' },
      { status: 'generating_tips' },
    ]);
    assert.equal(result.atsScore, 84);
    assert.equal(result.formattingReview, SAMPLE_REVIEW.formattingReview);
    assert.equal(result.impactReview, SAMPLE_REVIEW.impactReview);
    assert.equal(result.actionableTips.length >= 3 && result.actionableTips.length <= 5, true);
    assert.deepEqual(result.actionableTips, SAMPLE_REVIEW.actionableTips);
    assert.equal(model.requestCount, 3);
  });

  test('allows five attempts in ten minutes, blocks the sixth, and does not call the model', async () => {
    let now = 1_700_000_000_000;
    resetReviewRateLimit(() => now);
    model.respondWith(reviewResponse);
    const uid = 'recruiter-1';
    const input = { resumeText: resume(220) };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await flow(input, { context: { auth: { uid } } });
      assert.equal(result.atsScore, 84);
    }
    const callsAfterFive = model.requestCount;
    assert.equal(callsAfterFive, 15);

    const { stream, output } = flow.stream(input, { context: { auth: { uid } } });
    const chunks: unknown[] = [];
    await assert.rejects(
      async () => {
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        await output;
      },
      (error: unknown) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(error.code, 'resource-exhausted');
        assert.equal(
          error.message,
          'Rate limit exceeded: 5 review attempts per 10 minutes.',
        );
        return true;
      },
    );
    assert.deepEqual(chunks, []);
    assert.equal(model.requestCount, callsAfterFive);

    const other = await flow(input, { context: { auth: { uid: 'recruiter-2' } } });
    assert.equal(other.atsScore, 84);

    now += TEN_MINUTES_MS - 1;
    await assert.rejects(() => flow(input, { context: { auth: { uid } } }));
    assert.equal(model.requestCount, callsAfterFive + 3);

    now += 1;
    const afterWindow = await flow(input, { context: { auth: { uid } } });
    assert.equal(afterWindow.atsScore, 84);
    assert.equal(model.requestCount, callsAfterFive + 6);
  });

  test('skips the rate limit when callable auth is missing', async () => {
    model.respondWith(reviewResponse);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await flow({ resumeText: resume(210) }, { context: { auth: {} } });
      assert.equal(result.atsScore, 84);
    }
    const result = await flow({ resumeText: resume(210) });
    assert.equal(result.atsScore, 84);
    assert.equal(model.requestCount, 21);
  });
});
