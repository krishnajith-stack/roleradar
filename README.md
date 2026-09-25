# RoleRadar - online and local job-search workspace

Version 2.2 - updated 25 September 2026

**Open the application: https://krishnajith-stack.github.io/roleradar/**

1. Open **My CV** and import or paste your CV, then save it.
2. Use the LinkedIn, Naukri or Naukrigulf shortcuts to find jobs.
3. Choose **Add a job**, paste a public posting URL, and click **Fetch & add job**.
   RoleRadar extracts available job details, saves the role as **Saved**, and
   opens its description for review. You can also enter the details manually.
4. Track stages and notes in **Applications** and prepare drafts in **Resume studio**.

Board shortcuts and individual URL imports work without the feed API key.
Shortcuts open external websites; use **Fetch & add job** to import a selected posting.
LinkedIn carries the role and
location fields into its search. Set remaining filters on the destination board.
Automatic LinkedIn/Naukri feed import still requires provider configuration below.

URL import uses Jina AI Reader to read a public page. The submitted URL is sent to
that service, while your CV, notes and saved workspace remain in your browser.
No credentials or API key are sent to the reader. Supported pages expose
JobPosting structured data or recognisable job-description elements. Login walls,
access restrictions, expired postings, ambiguous multi-job pages and rate limits
produce an error with manual entry available; a failed import does not save a job.
The importer does not apply to an employer or mark a role as Applied. Review
extracted details; information absent from the source is not invented.

## New online edition

RoleRadar can now run on GitHub Pages without a Python installation. It uses
the same Python matching engine through Pyodide in a browser worker. Your CV,
application stages, notes and drafts are stored privately in that browser's
IndexedDB. They are **not uploaded to GitHub** and do not automatically sync
between devices. Export a backup before clearing site data or changing devices.

The new LinkedIn, Naukri and combined source options validate original apply-link
hosts. The online edition searches a **scheduled public feed snapshot**, not a
fresh provider request for each keyword search. The default is two cybersecurity
queries (India and UAE), once a week and when publishing. Broader coverage or more frequent refreshes
consume additional provider requests. Naukri availability depends on indexing;
an empty result does not mean there are no vacancies on Naukri.

See [DEPLOY.md](DEPLOY.md) for the separate-repository deployment and API-key setup.
No deployment or real feed refresh is implied by the included source files.
The initial feed is explicitly unconfigured, not a set of fake live vacancies.

Online features: CV import (DOCX/TXT/text-based PDF), original explainable scores,
job filtering, tracking and notes, evidence-based resume tailoring, DOCX/text/PDF
exports, and compatibility with version 1 backups. The desktop edition retains
Remotive, on-demand provider search and optional local Ollama. Local Ollama and
Remotive are not enabled in the GitHub Pages edition.

The first online visit downloads a pinned Pyodide runtime from jsDelivr.
PDF import additionally downloads pinned pypdf 6.0.0 from PyPI on first use.
Recent Chrome, Edge, Firefox or Safari with WebAssembly, IndexedDB and Web Locks are
required. Internet access is required to load the site/runtime and refresh the
published feed. This is not a guaranteed offline PWA.

## Development and checks

```sh
python -m unittest discover -s tests -v
python scripts/build_site.py
npm ci
npm run test:web
python -m http.server 8765 --directory site
```

Only the generated `site/` folder is published. Never publish the desktop `data/`
folder, backups, CV files, environment files or API keys. The workflow has an
explicit public-file build allowlist.

## Original desktop edition

Open **START-HERE.html** for the illustrated-style quick-start guide.

## Start on Windows

1. Extract the entire ZIP to a normal folder, for example `Documents\RoleRadar`. Do not run it from inside the ZIP.
2. Install Python 3.10 or newer from https://www.python.org/downloads/ if it is not already installed. Select **Add Python to PATH** during installation.
3. Double-click **Start-RoleRadar.bat**. Your browser opens at `http://127.0.0.1:8765`.
4. Keep the launcher window open while using the app. Close it or press Ctrl+C to stop; saved data stays on disk.
5. Open **My CV**, upload a DOCX / TXT or paste your full CV, check the extracted text and save.

The desktop app needs no third-party Python packages for its core features. It uses a local Python server, not a standalone double-click HTML file or a packaged Windows EXE. The separate GitHub Pages edition is described above.

## Mac / Linux

With Python 3.10+ installed, open a terminal in this folder and run:

```sh
python3 app.py
```

The included `Start-RoleRadar.command` is an alternative launcher. If it is not executable, run `chmod +x Start-RoleRadar.command` first. macOS may ask you to approve opening a downloaded script. Read the source if you are unsure; do not disable system security features.

## Search coverage

- **JSearch / OpenWeb Ninja:** broader indexed job results with country, city, keywords, date and remote filters. Add your own **OpenWeb Ninja** API key under Connections & data. This is not an OpenAI/ChatGPT key. Review the provider’s current plan and request limits before connecting. Search fetches one page; Load next page uses another request. Identical requests are cached for 15 minutes. Country is required; repeat searches for additional countries.
- **Remotive:** free public remote-job feed, no key. Listings are delayed by 24 hours and cached locally for 6 hours. Each job keeps its Remotive source and original listing link. Eligibility is conservatively filtered from the listing’s country/location text; broad regions such as EMEA may not map to an individual country. Leave city blank for remote searches. Always read the JD’s country restrictions. Results are limited to 150 per search.
- **Any other website:** use Add a job; paste the title, company, full JD and apply URL. Arbitrary sites are not scraped. Login walls, restrictions and CAPTCHAs are not bypassed.
- **My saved workspace:** filter locally saved jobs offline. The posted-date filter is not applied in this mode.

No app can guarantee coverage of every internet vacancy. Provider omissions, stale jobs, geographic indexing and incomplete descriptions all affect results. Job links may expire. Always verify the source before sending personal information. No applications are submitted automatically.

## Match scores: what 1–100 means

Scores are explainable heuristics, not an employer ATS score, verified skill assessment, or probability of getting hired. The dictionary is strongest for cybersecurity / IT: vulnerability management, SOC, Microsoft 365, identity, cloud, GRC, infrastructure, networking and leadership.

| Component | Base weight |
| --- | ---: |
| Recognized skills and tools | 60 |
| Role-title vocabulary | 15 |
| Broader JD vocabulary | 10 |
| Experience years | 10 |
| Certification keywords | 5 |

Components lacking applicable evidence are omitted and the remaining weights are normalized to 100. Experience uses the **total years you enter**, not verified years in each technology. Generic wording and dictionary gaps can distort scores. Preferred skills receive a lower weight when the same line labels them preferred; this simple rule cannot fully interpret all JD formatting. Explicit negations and in-progress certifications are excluded where recognizable, but text extraction is not perfect. Missing keywords mean “not evidenced in the CV,” not necessarily “you do not know this.” No score is generated without enough CV and JD text. Country, work authorization, language, clearance and salary are not part of the score.

## Applications

1. Open a job and review its full JD and match explanation.
2. Use **Open apply page** to submit on the source website yourself.
3. Change the stage to **Applied** after submitting. Opening an apply link does not mark a job Applied.
4. Add notes under **Updates**. Status changes are automatically recorded.
5. Add a follow-up date. Due dates appear in the dashboard; these are not scheduled notifications.

Statuses: Discovered, Saved, Applied, Screening, Interview, Offer, Rejected, Withdrawn.

Duplicate application URLs are merged after common tracking parameters are removed. Different URLs for the same underlying role can still create duplicates. Re-searching does not reset an existing job’s status, notes, follow-up or draft.

## Resume studio

- **Tailor from CV:** works offline without AI. Highlights existing CV-supported skills and reorders consecutive bullet groups within their original job. It preserves your history and does not creatively rewrite it.
- **Rewrite with local AI:** optional generative rewriting using an installed local Ollama model. Install Ollama from https://ollama.com/download, then run `ollama pull llama3.2` (an example; larger suitable local models may write better). Model downloads can be several GB. In Connections, click Find models, select a downloaded local model and save. Leave Ollama running. Cloud models are excluded.
- AI receives your CV and the selected JD via the loopback Ollama endpoint. No cloud AI API is configured by this app. Inference can take several minutes depending on hardware and model. Hardware requirements depend on your chosen model.
- The draft is editable and only saved to that job when you click Save draft. Your master CV is not overwritten. Switching jobs prompts before discarding an unsaved draft.
- A keyword guard rejects AI drafts that introduce dictionary skills/certifications not evidenced in the original CV. **This is not a complete factual check.** Check every number, employer, role title, date and claim; models can fabricate statements not caught by keyword checks.
- **Download Word:** creates a genuine `.docx` file, single-column, selectable text, no tables or text boxes.
- **Text:** downloads a plain-text resume.
- **Print / PDF:** opens your browser’s print dialog. Choose Save as PDF and disable browser headers/footers if desired. Check pagination before sending.
- ATS-friendly structure does not guarantee ATS compatibility with every employer or a successful application.

## Optional PDF import

DOCX and pasted CVs work without additional packages. For text-based PDFs, run **Install-PDF-Support.bat** on Windows, or:

```sh
python3 -m pip install -r requirements-optional.txt
```

The installer asks before downloading `pypdf` from PyPI. Restart RoleRadar afterwards. Scanned-image PDFs need OCR elsewhere; the app will tell you if there is no extractable text. Review reading order after importing multi-column PDFs. Legacy `.doc` is not supported; save it as DOCX first.

## Data, privacy and backups

- App records are stored in `data/roleradar.sqlite3` beside `app.py`, **not just in the browser cache**. Closing or changing browsers does not delete them.
- Data and exported backups are **not encrypted**. Anyone with access to your account/files may be able to read them. Use device encryption and protect backups; do not place the folder in a shared/public directory. OS or folder-sync backups are outside this app’s control.
- The server normally listens only on `127.0.0.1`. It validates Host/Origin and uses a session token on private APIs, with no cross-origin access. Do not expose or port-forward it onto the internet or a shared network. This is a personal app, not a hardened multi-user service.
- Your CV is not sent to job-search providers. Search terms and locations are sent when you choose a live search. Apply links open external websites with their own privacy practices. No analytics, CDN fonts or trackers are included.
- API keys entered in the UI are kept in server memory for the current session and are excluded from backups. Advanced users can set `OPENWEBNINJA_API_KEY` in their own environment instead; do not put secrets in source code.
- Use **Export backup** regularly. JSON exports include your CV, jobs, notes and drafts, but no API keys or job-feed caches.
- Import merges **new jobs only** and preserves existing records. Existing notes/drafts on duplicate jobs are not overwritten or merged. If there is no current CV, the backup CV is imported; otherwise your current CV stays. The import is additive, not a destructive point-in-time restore.
- To move the complete workspace unchanged, close the app and copy the whole folder including `data` to the other computer. Keep a separate backup first.
- Sample mode is explicitly fictional and available only in an empty workspace. Remove it using Connections & data before adding your real CV. Sample jobs have no real apply links.

## Troubleshooting

| Issue | What to do |
| --- | --- |
| Browser page does not open | Keep the launcher open and manually visit `http://127.0.0.1:8765`. |
| Python not found | Install Python 3.10+ and enable Add Python to PATH. Relaunch the app. |
| Port 8765 already in use | Close the other RoleRadar launcher, or run `python app.py --port 8766`. |
| Empty live results | Broaden keywords/specialism, try another country, clear city for remote roles, or use JSearch / manual imports. |
| JSearch 401/403/429 | Check the OpenWeb Ninja key, access plan and quota. Do not repeatedly retry quota errors. |
| Could not connect | Check your internet, provider availability, or whether Ollama is running if rewriting locally. Saved data remains usable. |
| Local model not listed | Download a local model with Ollama, keep Ollama running, and click Find models. Cloud models are deliberately excluded. |
| File import is out of order | Correct the extracted text or paste a clean text version, then Save CV. |
| Reload message after restart | Reload the browser tab to receive a fresh local session token. |

## Source and checks

The ZIP includes all app source and focused tests. No build or npm install is required to run it. `package.json` is included only for developer preview compatibility, not normal use.

```sh
python -m unittest discover -s tests -v
```

Twelve automated checks cover scoring, aliases, incomplete input, duplicate preservation, country filters, dates/URL validation, DOCX text round-trip, role attribution, atomic backup merging, source-response parsing/caching, AI keyword guards and localhost API safeguards. Browser checks covered desktop initial launch, sample match explanations, application updates and resume editing/saving. Exported DOCX bytes passed structural/text round-trip checks; the remote test browser did not expose a completed browser-download event, so end-to-end browser download capture could not be confirmed. The public Remotive endpoint was reachable during development. JSearch requires a user key and local AI requires an installed model, so those two live integrations were not run end to end. Windows/macOS launchers were reviewed but not executed on those operating systems. Optional browser WebMCP support is feature-detected; the test browser did not expose that API.

Provider references (reviewed 22 September 2026):

- JSearch endpoint, authentication, geography and cursor pagination: https://www.openwebninja.com/api/jsearch
- Remotive feed, attribution, 24-hour delay and request guidance: https://github.com/remotive-com/remote-jobs-api
- Ollama local chat API: https://docs.ollama.com/api/chat
- Ollama installed-model discovery: https://docs.ollama.com/api/tags

## File map

```text
RoleRadar/
  START-HERE.html             Quick start; open this first
  Start-RoleRadar.bat         Windows launcher
  Start-RoleRadar.command     Mac / Linux launcher
  Install-PDF-Support.bat     Optional PDF setup
  app.py                     Local server, matching, storage and exports
  static/                    Dashboard HTML, CSS and JavaScript
  tests/                     Focused regression checks
  requirements-optional.txt   Optional PDF dependency only
  README.md                  Full instructions
  data/                      Created on first launch; keep this folder safe
```
