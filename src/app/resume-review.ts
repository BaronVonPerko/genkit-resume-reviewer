export const MIN_RESUME_CHARACTERS = 200;
export const MAX_RESUME_CHARACTERS = 12_000;

export interface AnalyzeResumeInput {
  resumeText: string;
}

export interface ResumeReview {
  atsScore: number;
  formattingReview: string;
  impactReview: string;
  actionableTips: string[];
}

export type ReviewStep = 'parsing_structure' | 'analyzing_impact' | 'generating_tips';

export type ReviewStatus = 'idle' | ReviewStep | 'complete' | 'error';

export interface AnalyzeResumeChunk {
  status: ReviewStep;
}

export interface ReviewStepView {
  id: ReviewStep;
  title: string;
}

export const REVIEW_STEPS: readonly ReviewStepView[] = [
  { id: 'parsing_structure', title: 'Parsing structure' },
  { id: 'analyzing_impact', title: 'Analyzing impact' },
  { id: 'generating_tips', title: 'Generating tips' },
];

export function formatCharacterCount(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
