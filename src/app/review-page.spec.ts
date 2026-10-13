import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SAMPLE_RESUME } from '../../shared/sample-resume';
import { ReviewPage } from './review-page';
import { type ResumeReview, type ReviewStatus } from './resume-review';
import { ResumeReviewService } from './resume-review.service';

class StubResumeReviewService {
  readonly status = signal<ReviewStatus>('idle');
  readonly result = signal<ResumeReview | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly authReady = signal(true);
  readonly authError = signal<string | null>(null);
  readonly signInRequired = signal(false);
  readonly signedInEmail = signal<string | null>(null);
  readonly signIn = vi.fn(async (_email: string, _password: string) => {});
  readonly createAccount = vi.fn(async (_email: string, _password: string) => {});
  readonly review = vi.fn(async (_resumeText: string) => {});
}

describe('ReviewPage', () => {
  let stub: StubResumeReviewService;

  beforeEach(async () => {
    stub = new StubResumeReviewService();
    await TestBed.configureTestingModule({
      imports: [ReviewPage],
      providers: [{ provide: ResumeReviewService, useValue: stub }],
    }).compileComponents();
  });

  it('asks for a verified email before a hosted review', () => {
    stub.authReady.set(false);
    stub.signInRequired.set(true);
    const fixture = createPage();

    expect(button(fixture, 'Sign in')).toBeTruthy();
    expect(button(fixture, 'Review resume').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('#sign-in-email')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#current-password')).toBeTruthy();
  });

  it('loads the sample resume into the textarea', () => {
    const fixture = createPage();
    const textarea = resumeField(fixture);
    expect(textarea.value).toBe('');

    button(fixture, 'Load sample resume').click();
    fixture.detectChanges();

    expect(textarea.value).toBe(SAMPLE_RESUME);
    expect(button(fixture, 'Review resume').disabled).toBe(false);
  });

  it('disables review for empty, short, and over-limit text', () => {
    const fixture = createPage();
    const review = button(fixture, 'Review resume');
    expect(review.disabled).toBe(true);

    setResume(fixture, 'a'.repeat(199));
    expect(button(fixture, 'Review resume').disabled).toBe(true);
    expect(lengthMessage(fixture)).toContain('Enter at least 200 characters');

    setResume(fixture, 'a'.repeat(12_001));
    expect(button(fixture, 'Review resume').disabled).toBe(true);

    setResume(fixture, `  ${'a'.repeat(200)}  `);
    expect(button(fixture, 'Review resume').disabled).toBe(false);

    stub.status.set('parsing_structure');
    fixture.detectChanges();
    expect(button(fixture, 'Review resume').disabled).toBe(true);

    stub.status.set('idle');
    stub.authReady.set(false);
    fixture.detectChanges();
    expect(button(fixture, 'Review resume').disabled).toBe(true);
  });

  it('shows an explanation when the resume is over the limit', () => {
    const fixture = createPage();
    setResume(fixture, 'b'.repeat(12_001));

    const message = lengthMessage(fixture);
    expect(message).toContain('over the 12,000 character limit');
    expect(message).toContain('Shorten it before requesting a review.');
    expect(fixture.nativeElement.textContent).toContain('12,001 / 12,000 characters');
  });

  it('shows step 2 as current and step 1 as done while analyzing impact', () => {
    const fixture = createPage();
    stub.status.set('analyzing_impact');
    fixture.detectChanges();

    expect(stepState(fixture, 'parsing_structure')).toBe('Done');
    expect(stepState(fixture, 'analyzing_impact')).toBe('Current');
    expect(stepState(fixture, 'generating_tips')).toBe('Waiting');
    expect(stepElement(fixture, 'analyzing_impact').getAttribute('aria-current')).toBe('step');
    expect(fixture.nativeElement.textContent).toContain('Current step: Analyzing impact.');
  });

  it('renders the score, both reviews, and the tips when complete', () => {
    const fixture = createPage();
    setResume(fixture, SAMPLE_RESUME);
    const review: ResumeReview = {
      atsScore: 87,
      formattingReview: 'Sections follow a clear order and the headings are easy to scan.',
      impactReview: 'The bullets use action verbs and include quantified results.',
      actionableTips: [
        'Move the skills section above education.',
        'Add the team size to the redesign bullet.',
        'Shorten the summary to three lines.',
      ],
    };
    stub.result.set(review);
    stub.status.set('complete');
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('[data-region="result"]') as HTMLElement;
    expect(result.textContent).toContain('87');
    expect(result.textContent).toContain('out of 100');
    expect(result.textContent).toContain(review.formattingReview);
    expect(result.textContent).toContain(review.impactReview);
    const tips = [...result.querySelectorAll('li')].map((item) => item.textContent?.trim());
    expect(tips).toEqual(review.actionableTips);
    expect(resumeField(fixture).value).toBe(SAMPLE_RESUME);
    expect(fixture.nativeElement.querySelector('button')?.textContent).toContain(
      'Load sample resume',
    );
    expect(buttonExists(fixture, 'Try again')).toBe(false);
  });

  it('renders the error message and Try again runs the review', () => {
    const fixture = createPage();
    setResume(fixture, SAMPLE_RESUME);
    stub.result.set({
      atsScore: 10,
      formattingReview: 'Previous formatting review.',
      impactReview: 'Previous impact review.',
      actionableTips: ['Previous tip'],
    });
    stub.errorMessage.set('The review failed. Try again.');
    stub.status.set('error');
    stub.result.set(null);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The review failed. Try again.');
    expect(fixture.nativeElement.querySelector('[data-region="result"]')).toBeNull();
    expect(resumeField(fixture).value).toBe(SAMPLE_RESUME);

    button(fixture, 'Try again').click();

    expect(stub.review).toHaveBeenCalledTimes(1);
    expect(stub.review).toHaveBeenCalledWith(SAMPLE_RESUME);
  });

  function createPage(): ComponentFixture<ReviewPage> {
    const fixture = TestBed.createComponent(ReviewPage);
    fixture.detectChanges();
    return fixture;
  }
});

function resumeField(fixture: ComponentFixture<ReviewPage>): HTMLTextAreaElement {
  const textarea = fixture.nativeElement.querySelector('textarea');
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('Resume textarea is missing.');
  }
  return textarea;
}

function setResume(fixture: ComponentFixture<ReviewPage>, value: string): void {
  const textarea = resumeField(fixture);
  textarea.value = value;
  textarea.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function button(fixture: ComponentFixture<ReviewPage>, name: string): HTMLButtonElement {
  const match = [...fixture.nativeElement.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(name),
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${name}.`);
  }
  return match;
}

function buttonExists(fixture: ComponentFixture<ReviewPage>, name: string): boolean {
  return [...fixture.nativeElement.querySelectorAll('button')].some((element) =>
    element.textContent?.includes(name),
  );
}

function lengthMessage(fixture: ComponentFixture<ReviewPage>): string {
  return fixture.nativeElement.querySelector('#resume-length-message')?.textContent?.trim() ?? '';
}

function stepElement(fixture: ComponentFixture<ReviewPage>, id: string): HTMLElement {
  const element = fixture.nativeElement.querySelector(`[data-step="${id}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing step ${id}.`);
  }
  return element;
}

function stepState(fixture: ComponentFixture<ReviewPage>, id: string): string {
  return stepElement(fixture, id).querySelector('[data-state]')?.textContent?.trim() ?? '';
}
