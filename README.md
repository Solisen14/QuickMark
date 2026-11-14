# QuickMark

**Scan. Score. Done.** A mobile-first, privacy-conscious multiple-choice grader, built as part of [The Curiosity Lab](https://solisen14.github.io/the-curiosity-lab/).

**Status:** v0.6 experimental prototype. Its scoring logic passes synthetic-image tests, but real printed sheets and iPhone camera conditions have **not yet been validated**. Always inspect and confirm grades before recording them.

## Balanced assessment acknowledgement

First-time visitors see a welcome message emphasizing that multiple-choice questions can be useful, but that varied evidence of learning matters across all subject areas. Users must check **“I acknowledge the importance of using a balanced approach to assessment.”** before continuing.

- The message is **educational guidance**, not a policy declaration or restriction on the number of multiple-choice questions.
- The acknowledgement is saved **only on that device** in browser localStorage, using a separate key from the answer key.
- Teachers can reopen the information any time using the **About Assessment** link in the footer.
- A first-time visitor cannot dismiss the dialog using Escape without acknowledging. On subsequent visits, the information dialog is dismissible.
- When local storage is unavailable, teachers can still acknowledge and use QuickMark for their current visit, but the message may reappear next time.

## What it does

1. **Answer key:** Enter any whole number of questions from 1 to 50; select four (A–D) or five (A–E) choices. Counts below 5 or above 25 show an optional teaching suggestion, but are never blocked. Tap correct letters, or paste an answer string. The key and optional test title save in the current browser.
2. **Print:** Generate a one-page US Letter answer sheet with four solid black corner markers and an encoded format identifier. Print at 100% / Actual size.
3. **Scan:** Open QuickMark in Safari on an iPhone, tap **Take photo**, and photograph the completed answer sheet upright, in even lighting, with all corners visible. You can also choose an existing image.
4. **Review:** QuickMark detects alignment markers, verifies the layout code, reads bubbles and shows a provisional score. Blank and multiple/uncertain markings are distinguishable. Edit any detected answer using the per-question dropdown, then confirm.

## Using a laptop and iPhone together

Make the key on your computer, then click **Copy key link**. Open that link on your iPhone to import the same test settings and solutions. The URL fragment contains the answer key and is not sent to the QuickMark website in normal web requests, so no account or shared database is required. **Keep the link private from students**, because someone with the link can read the answer key.

## Live camera scanning (experimental)

- In **Scan & score**, tap **Start live scan** to request permission for the rear camera. This requires HTTPS (GitHub Pages provides it).
- Hold the entire completed QuickMark sheet in view, including all four alignment squares. The app analyzes video frames locally, checks the sheet format, and requires **three consecutive matching readings** before showing a score.
- A green grade overlay appears over the sheet in the camera preview. A detailed question-by-question review appears below. The score remains **unconfirmed** until the teacher checks and confirms it.
- Tap **Review answers** to inspect uncertain bubbles and override incorrect detections. Tap **Scan next sheet** after removing the previous sheet from view; this prevents rescanning the same page by accident.
- Tap **Stop camera**, change tabs, or switch away from the page to release camera access. Photos remain a fallback for unsupported devices and difficult sheets.
- No photos, video frames, or grades are sent to a server or automatically stored. Frames are processed in memory only.

**Important:** The live scanner has not been physically tested on an iPhone or real printed pages. Three agreeing frames do not prove a reading is correct. Always review grades against the actual paper before entering student results. Lighting, movement, print scale and devices may affect recognition. Performance may vary between browsers.

## Getting it online with GitHub Pages

This is a static site with no build step or third-party dependencies.

1. Open this repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then **main** and **/(root)**. Click **Save**.
4. When publishing finishes, the site should be at **https://solisen14.github.io/QuickMark/**.

You can add the site to your iPhone Home Screen from Safari's Share menu. It can work offline after its assets have successfully cached during an online visit. First-time use requires the site to load online.

## Privacy and data handling

- Photo processing and bubble detection happen **entirely in the browser** using the Canvas API.
- The app makes **no photo uploads** and has **no accounts, advertising, or external analytics**.
- Only the **answer key, question format, and optional test title** are stored in your browser's localStorage. A manually copied transfer link also contains these details in its fragment.
- Captured image pixels and results live in memory for the current session and are not saved by QuickMark or sent to a server.
- Your browser, iPhone camera app, operating system, or a user's manual screenshots may maintain their own copies; QuickMark does not control those.
- Avoid collecting student identifiers in this prototype. Follow your school board's privacy and assessment requirements before classroom use.

## Technical notes

- index.html and styles.css: responsive three-step teacher interface and print stylesheet
- app.js: answer-key editor, SVG sheet builder, camera/photo handling, review workflow
- omr.js: marker detection, projective geometry, bubble contrast measurement, format identifiers, counting guidance, scoring
- assessment.js: accessible welcome dialog and device-local acknowledgement persistence
- live-camera.js: rear-camera video, page tracking, over-page grade and camera lifecycle
- live-scan.js: consensus checks for consecutive camera readings
- sw.js: offline cache for application assets only
- tests/omr.test.mjs: synthetic image and scoring regression tests
- .github/workflows/test.yml: automated Node tests and JavaScript syntax checks

No external libraries or APIs are used. The alignment squares define a perspective mapping from the printed page to the captured image. The format code helps reject a sheet printed using different settings or an older sheet layout. If the four markers or format code cannot be confidently read, the application refuses to produce a scan result.

## Developer checks

Requires Node.js 22+ for the built-in test runner.

~~~sh
npm test
node --check app.js
node --check omr.js
node --check sw.js
~~~

## Before relying on grades

This first release needs field trials with different iPhone models, papers, print scaling, lighting conditions, pencil marks, pens, erasures, rotated pages, skew, and multiple markings. Compare every scanned result against a hand-graded sheet until accuracy is established. The format marker reader and front-end interactions also require physical-device checks.

**Known scope:** US Letter only; one active key per browser; no class roster, names, cloud backup, LMS integration, or saved result history. For a fresh scan, photograph the next sheet; use **Copy result summary** if needed.

Built for educators and curious people who like useful tools.
