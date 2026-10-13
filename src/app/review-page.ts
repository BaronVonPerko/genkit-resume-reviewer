import { Component, computed, inject, signal } from '@angular/core';
import { SAMPLE_RESUME } from '../../shared/sample-resume';
import {
  formatCharacterCount,
  MAX_RESUME_CHARACTERS,
  MIN_RESUME_CHARACTERS,
  REVIEW_STEPS,
  type ReviewStatus,
} from './resume-review';
import { ResumeReviewService } from './resume-review.service';

type LengthIssue = 'short' | 'long' | null;
type StepStateLabel = 'Current' | 'Done' | 'Waiting';

@Component({
  selector: 'app-review-page',
  templateUrl: './review-page.html',
  host: {
    class: 'block min-h-dvh bg-white text-slate-900',
  },
})
export class ReviewPage {
  private readonly reviews = inject(ResumeReviewService);

  protected readonly minimumCharacters = MIN_RESUME_CHARACTERS;
  protected readonly formattedMaximum = formatCharacterCount(MAX_RESUME_CHARACTERS);
  protected readonly resumeText = signal('');
  protected readonly status = this.reviews.status;
  protected readonly result = this.reviews.result;
  protected readonly errorMessage = this.reviews.errorMessage;
  protected readonly authReady = this.reviews.authReady;
  protected readonly authError = this.reviews.authError;

  protected readonly trimmedLength = computed(() => this.resumeText().trim().length);
  protected readonly formattedCount = computed(() => formatCharacterCount(this.trimmedLength()));
  protected readonly lengthIssue = computed<LengthIssue>(() => {
    const length = this.trimmedLength();
    if (length === 0) {
      return null;
    }
    if (length < MIN_RESUME_CHARACTERS) {
      return 'short';
    }
    if (length > MAX_RESUME_CHARACTERS) {
      return 'long';
    }
    return null;
  });
  protected readonly lengthMessage = computed(() => {
    const issue = this.lengthIssue();
    if (issue === 'long') {
      return `This resume is over the ${this.formattedMaximum} character limit. Shorten it before requesting a review.`;
    }
    if (issue === 'short') {
      return `Enter at least ${this.minimumCharacters} characters to request a review.`;
    }
    return '';
  });
  protected readonly lengthMessageClass = computed(() =>
    this.lengthMessage()
      ? 'rounded-md border-2 border-red-800 bg-red-50 px-4 py-3 text-xl leading-relaxed text-red-900'
      : '',
  );
  protected readonly reviewRunning = computed(() => isRunning(this.status()));
  protected readonly canReview = computed(
    () => this.authReady() && !this.reviewRunning() && this.withinLimit(),
  );
  protected readonly steps = computed(() => {
    const status = this.status();
    const currentIndex = REVIEW_STEPS.findIndex((step) => step.id === status);
    const allDone = status === 'complete';
    return REVIEW_STEPS.map((step, index) => {
      const stateLabel = stepState(allDone, currentIndex, index);
      return {
        ...step,
        stateLabel,
        current: stateLabel === 'Current',
        rowClass: stepRowClass(stateLabel),
      };
    });
  });
  protected readonly announcement = computed(() => {
    switch (this.status()) {
      case 'parsing_structure':
        return 'Current step: Parsing structure. Step 1 of 3.';
      case 'analyzing_impact':
        return 'Current step: Analyzing impact. Step 2 of 3.';
      case 'generating_tips':
        return 'Current step: Generating tips. Step 3 of 3.';
      case 'complete': {
        const score = this.result()?.atsScore;
        return score === undefined
          ? 'Review complete.'
          : `Review complete. ATS score ${score} out of 100.`;
      }
      case 'error':
        return this.errorMessage() ?? 'The review failed. Try again.';
      default:
        return 'Ready to review a resume.';
    }
  });
  protected readonly announcementClass = computed(() =>
    this.status() === 'error'
      ? 'rounded-md border-2 border-red-800 bg-red-50 px-4 py-3 text-xl leading-relaxed text-red-900'
      : 'text-xl leading-relaxed text-slate-700',
  );

  protected onResumeInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    this.resumeText.set(target.value);
  }

  protected loadSample(): void {
    this.resumeText.set(SAMPLE_RESUME);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.review();
  }

  protected review(): void {
    if (!this.canReview()) {
      return;
    }
    void this.reviews.review(this.resumeText());
  }

  private withinLimit(): boolean {
    const length = this.trimmedLength();
    return length >= MIN_RESUME_CHARACTERS && length <= MAX_RESUME_CHARACTERS;
  }
}

function isRunning(status: ReviewStatus): boolean {
  return (
    status === 'parsing_structure' ||
    status === 'analyzing_impact' ||
    status === 'generating_tips'
  );
}

function stepState(allDone: boolean, currentIndex: number, index: number): StepStateLabel {
  if (allDone || (currentIndex >= 0 && index < currentIndex)) {
    return 'Done';
  }
  if (index === currentIndex) {
    return 'Current';
  }
  return 'Waiting';
}

function stepRowClass(stateLabel: StepStateLabel): string {
  const layout =
    'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 rounded-lg px-4 py-4 text-xl text-slate-900 sm:text-2xl';
  if (stateLabel === 'Current') {
    return `${layout} border-4 border-blue-800 bg-blue-50 font-bold`;
  }
  if (stateLabel === 'Done') {
    return `${layout} border-2 border-slate-700 bg-white font-semibold`;
  }
  return `${layout} border-2 border-slate-600 bg-white`;
}
