# Demo requirements: AI resume reviewer

Requirements for the live demo in **From Zero to AI-Powered: Building Modern Web Apps with Firebase Genkit**.

The demo is a small app that reads pasted resume text and returns a structured review. The backend is a Firebase Genkit flow. The primary UI is this Angular app. A thin React example calls the same flow, so the talk can show that the AI logic is not tied to one frontend.

The interaction model follows [Streaming real-time AI telemetry with Firebase Genkit and Angular Signals](https://perko.dev/blog/post/2026-07-07-streaming-real-time-ai-telemetry-with-firebase-genkit-and-angular-signals): a multi-step model pipeline streams status milestones to the client, then returns one structured result. Progress is not written to a database.

## What the audience should see

1. Paste a resume, or load the built-in sample.
2. Start a review and watch three pipeline steps update live.
3. Receive a typed result: an ATS score, a formatting review, an impact review, and a short list of tips.
4. A glance at the Genkit Developer UI showing the same flow, its prompts, and a trace of the three model calls.

The app stays on one screen. It does not chat, upload files, or save history.

## Product behavior

### Input

- A single text field for resume text (plain text or Markdown).
- A **Load sample resume** action that fills the field with a short fictional resume checked into the repo. The talk should not depend on copying a resume from another window.
- A **Review resume** action.
- The review action is unavailable while a review is running, and while the text is empty or outside the length limits below.

### Pipeline

One Genkit flow, `analyzeResume`, runs three model calls in order. Each call is its own step so the Developer UI trace shows them separately. The model for every call is `gemini-flash-latest` (the current Gemini Flash alias). Do not pin an older Flash id such as `gemini-1.5-flash`.

| Step | Stream status | What the model does |
| --- | --- | --- |
| 1 | `parsing_structure` | Read the resume and note layout, section order, and ATS-friendliness. Return plain-text notes. |
| 2 | `analyzing_impact` | Review bullets for action verbs and quantified results. Return plain-text notes. |
| 3 | `generating_tips` | Turn both sets of notes into the final object. This is the only call that uses a structured output schema. |

The flow sends a status chunk **before** each model call, using Genkit `sendChunk`. It does not stream model tokens. The stream exists so the UI can show which step is running.

When step 3 finishes, the flow returns the object and the stream ends. If any step fails, the flow fails and the client shows an error state. There is no partial score.

### Result

The final object is:

| Field | Type | Meaning |
| --- | --- | --- |
| `atsScore` | integer 0–100 | How easily an applicant-tracking system could parse this resume. |
| `formattingReview` | string | A short paragraph from the structure pass. |
| `impactReview` | string | A short paragraph from the impact pass. |
| `actionableTips` | 3 to 5 strings | Concrete edits the candidate could make. |

Zod on the server is the contract. The Angular client and the React example each declare a matching TypeScript type. They do not re-validate with a second schema.

### Client states

The UI reflects exactly one of these states:

| State | What the user sees |
| --- | --- |
| `idle` | The form, with no score and no error. |
| `parsing_structure` | Step 1 of 3 is current. |
| `analyzing_impact` | Step 2 of 3 is current. Steps already finished stay visible as done. |
| `generating_tips` | Step 3 of 3 is current. |
| `complete` | Score, both reviews, and the tip list. The form stays filled so the demo can be run again. |
| `error` | A short message that the review failed, plus a way to try again. The previous result is cleared. |

Starting a new review clears the previous result immediately and returns the pipeline to step 1.

## Backend

The flow lives in a Firebase Functions package in this repo (for example `functions/`). The Angular app does not call Gemini.

### Flow shape

Use `ai.defineFlow` from Genkit, then expose that flow with `onCallGenkit` from `firebase-functions/https`. The callable is a wrapper. The workflow itself is the flow, so it can be run from the Genkit Developer UI and the CLI without deploying.

- **Name:** `analyzeResume`
- **Input schema:** an object with `resumeText: string`. Use an object schema so the Developer UI shows a labeled field.
- **Stream schema:** an object with `status` limited to `parsing_structure`, `analyzing_impact`, and `generating_tips`.
- **Output schema:** the result object above.
- **Runtime checks:** Genkit rejects input that fails the Zod schema before any model call. `resumeText` is required, trimmed, and between 200 and 12,000 characters.
- **Structured output:** the final `generate` call sets `output: { schema }` to the result schema. If the model returns nothing that matches, the flow throws.
- **Prompts:** each step is an `ai.definePrompt` (or a `.prompt` file) with its own name, input schema, and instructions. Prompts are not inline template strings buried in the flow. The speaker can open a prompt in the Developer UI, change it, and rerun it.

Prompt instructions tell the model it is reviewing a resume, to stay specific to the text it was given, and to avoid inventing employers, dates, or metrics that are not in the resume. The final prompt receives the two note strings, not a second copy of the full resume, so the talk can show a chain of steps instead of one giant prompt.

### Security and rate limiting

These are part of the demo, not follow-up work. The talk calls them out.

- The Gemini API key is a Cloud Functions secret (`defineSecret`). It is passed to `onCallGenkit` via `secrets`. It is not in Angular environment files, source, or the browser.
- The deployed callable uses `authPolicy: hasClaim('email_verified')` and `enforceAppCheck: true`.
- Local emulator runs may use the Auth emulator and an App Check debug token. Document that path. Do not turn the checks off in the deployed function config.
- Rate limit: **5 review attempts per signed-in user per 10 minutes**. Enforce it inside the function before the first model call, and return a clear callable error when the limit is hit. An in-memory counter is enough for this demo because `maxInstances` stays at 2. The code comment should say a multi-instance deployment would store the counter in Firestore or Memorystore.
- Set a function timeout of 120 seconds and `maxInstances: 2` so a cold demo cannot fan out.
- Do not log the raw resume text.

### What the client calls

The Angular service and the React hook call the deployed (or emulated) callable and read its stream. They do not import Genkit. Firebase Auth attaches the user token. App Check attaches its token through the Firebase SDK setup.

## Angular app

This repo is already an Angular 22 app with Tailwind. The reviewer replaces the CLI placeholder on the home route. Keep the implementation aligned with the project’s Angular practices:

- Standalone components, `inject()`, signals, and native `@if` / `@for` / `@switch`.
- A single injectable service owns the callable call and the writable signals. Components read `asReadonly()` signals.
- Signal state covers the current step and the latest result. No Firestore listener and no RxJS pipeline for the stream.
- The service uses the Firebase callable stream (`stream` async iterable, then `data` for the final object) and maps chunks onto the step signal.
- One focused component for the page is enough. Split a presentational piece only if the page component stops being readable.

### UI

The page is meant to be readable from the back of a room.

- Page title: **AI Resume Reviewer**.
- Labeled textarea, sample action, and primary review action.
- A pipeline list of the three steps. The current step is visually distinct. Completed steps stay marked done.
- The status region is an `aria-live="polite"` region so the step changes are announced.
- When complete, show the score as a number out of 100, then the formatting review, the impact review, and the tips as a list.
- The error state is text, not only a color change.
- Keyboard: the actions are real buttons, the textarea has an accessible name, and focus stays on the page (no surprise focus jump).
- Color contrast meets WCAG AA. Status is not conveyed by color alone.
- Layout works at a desktop projector width and at a narrow viewport. Tailwind utilities already available in the app are the styling tool.

Empty, in-progress, complete, error, and over-limit input are all visible states. Over-limit input is explained next to the field (character count and the 12,000 cap) before the user submits.

## React example

Add a minimal React example under `examples/react/` so the talk can show a second client against the same flow. It is not a second product.

- One custom hook, `useResumeReview`, that calls the same callable, exposes the current step, the result, an error, and a `runAnalysis` function.
- One small page that wires the hook to a textarea and a button and prints the step plus the final score and tips.
- No shared UI kit with the Angular app. The point is the consumption pattern, not visual parity.

## Local testing

Two loops, both required for the talk:

1. **Genkit Developer UI.** `genkit start` loads the functions entry file. From the Run tab the speaker can execute `analyzeResume` with the sample resume, then open the trace and show the three generates, the prompt text, and the structured output. `genkit flow:run analyzeResume '<json>' -s` is the CLI equivalent and should work.
2. **App against the emulator.** Firebase emulators for Functions and Auth, the Angular app pointed at them, and a verified demo user. Clicking **Review resume** streams the three statuses and then renders the result.

A checked-in sample input (the same fictional resume) is the default payload in the Developer UI docs/comment and the **Load sample resume** button.

## Out of scope

- PDF or DOCX upload, and any file parsing.
- Accounts UI beyond what the emulator needs for a verified demo user.
- Saving reviews, history, or sharing a result.
- Follow-up chat or rewrite-my-bullet actions.
- Writing progress documents to Firestore.
- Remote Config model switching, evaluation datasets, and production monitoring dashboards.
- A polished, deployed production environment. Deployed function options are specified so the security slide is real code, not a mock.

## Acceptance criteria

- `analyzeResume` is a Genkit flow with object input, stream, and output schemas, wrapped by `onCallGenkit`.
- Every model call uses `gemini-flash-latest`.
- The flow emits the three statuses in order, then returns `atsScore`, `formattingReview`, `impactReview`, and 3–5 `actionableTips`.
- A resume shorter than 200 characters or longer than 12,000 characters never reaches the model.
- The sixth attempt by the same user inside 10 minutes fails with a rate-limit error and does not call the model.
- The API key is only referenced as a Functions secret.
- The Angular page can load the sample resume, show each step as it arrives, and render the final result without a reload.
- A failed call shows the error state and can be retried.
- The React hook drives the same statuses and result from the same callable.
- The flow runs from the Genkit Developer UI with the sample resume, and the trace contains three generation steps.
- The page meets WCAG AA for the controls and status text described above: names, focus, contrast, and a live region.
