# GenkitResumeReviewer

## Local demo

Two loops cover the talk. The first runs the `analyzeResume` flow in the Genkit Developer UI. The second runs the Angular page against the Auth and Functions emulators. Both use the fictional resume in `shared/sample-resume.ts` and `shared/analyze-resume.sample.json` (Jordan Hale). The demo project id is `demo-genkit-resume-reviewer`.

The Gemini key stays a Cloud Functions secret named `GEMINI_API_KEY`. Copy `functions/.secret.local.example` to `functions/.secret.local` when that example is present, and set:

```bash
GEMINI_API_KEY=your-key
```

`functions/.secret.local` is gitignored. The Functions emulator reads that file for `defineSecret`. Export the same variable in the shell before starting the Genkit Developer UI.

### Genkit Developer UI

From `functions/`:

```bash
cd functions
npm install
export GEMINI_API_KEY=your-key
npm run genkit:start
```

`npm run genkit:start` runs `genkit start -- npx tsx src/index.ts`. In the Run tab, execute the flow `analyzeResume`. The default payload is `shared/analyze-resume.sample.json`.

The CLI equivalent, from `functions/` with the key exported:

```bash
genkit flow:run analyzeResume "$(cat ../shared/analyze-resume.sample.json)" -s
```

The trace shows three generation steps: parse structure, analyze impact, and generate tips. The final prompt receives the two note strings. It does not receive the full resume again.

### App against the emulators

The page signs in `demo@example.com` / `demo-password` on its own. Auth listens at `http://127.0.0.1:9099`. Functions listens at `127.0.0.1:5001`. In emulator mode the client sends the App Check debug token `demo-app-check-debug-token`.

Create `functions/.secret.local` with `GEMINI_API_KEY` before starting the Functions emulator, the same file as the Genkit loop.

Terminal A, from the repo root:

```bash
npx -y firebase-tools@latest emulators:start --only auth,functions
```

Terminal B, after Auth is up:

```bash
node scripts/seed-demo-user.mjs
```

That script creates `demo@example.com` when needed and sets `emailVerified` to true. Running it again is safe.

Terminal C:

```bash
npm start
```

Open `http://localhost:4200/`. Click **Load sample resume**, then **Review resume**. The page streams `parsing_structure`, `analyzing_impact`, and `generating_tips`, then renders `atsScore`, `formattingReview`, `impactReview`, and `actionableTips`.

These checks stay on in the function code: `authPolicy: hasClaim('email_verified')`, `enforceAppCheck: true`, `GEMINI_API_KEY` as a Functions secret (the Angular app never receives it), 5 reviews per user per 10 minutes, `timeoutSeconds: 120`, and `maxInstances: 2`. The local path uses the Auth emulator and the client App Check debug token.

A real Firebase project id and web app config replace the placeholders when you deploy. Deployment is intentionally outside this repo change.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.1.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
