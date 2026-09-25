# Publish RoleRadar on GitHub Pages

## 1. Separate repository

Create a repository named `roleradar` under your GitHub account. A public repository
is the simplest GitHub Pages setup. The code and published job snapshot will be
public; your imported CV and tracker data remain in each browser.

Upload the files **inside** the RoleRadar folder to the repository root, including
`.github/workflows`. Do not upload `node_modules`, `data`, backups, CVs or `.env`
files. Keep API keys out of files, commits, screenshots and chat messages.

Alternatively, from the RoleRadar directory:

```sh
git init -b main
git add .
git commit -m "Add RoleRadar online edition"
git remote add origin https://github.com/YOUR_USERNAME/roleradar.git
git push -u origin main
```

Replace YOUR_USERNAME with your GitHub account. Authenticate using GitHub's
normal secure sign-in or Git credential manager, not a token written into the URL.

## 2. Enable online hosting

Open repository Settings > Pages. Choose **GitHub Actions** as the build and
deployment source. Under Actions, run **Publish RoleRadar**. After it succeeds,
GitHub shows the actual website URL in Settings > Pages and the deployment job.
Do not assume the app is live until that deployment succeeds.

## 3. Connect the automatic job feed

1. Obtain an OpenWeb Ninja JSearch API key. This is not an OpenAI key and not a
   LinkedIn or Naukri password. Review the provider plan, quota and permission to
   publicly display returned listing text before enabling the public feed.
2. In repository Settings > Secrets and variables > Actions, add a repository
   secret named **OPENWEBNINJA_API_KEY**. Paste the value only into GitHub's secret
   field. Never put it in the source code or frontend.
3. Review `feed-config.json`. The default queries are cybersecurity in India and
   the UAE, one page each. Searches only retain actual LinkedIn/Naukri apply links.
4. Run **Refresh job feed** under Actions. A successful refresh commits the public
   snapshot and redeploys the site. Then reload RoleRadar.

Publishing also attempts a feed refresh when a provider key is configured. A
provider error is reported in Actions and the existing repository snapshot is
used so that a feed outage does not block application updates. The scheduled
workflow commits successful snapshots back to the repository.

The schedule is Mondays at 03:17 UTC, two API requests per run by default. GitHub
may delay scheduled runs or disable inactive public-repository schedules. Manual
runs are available. A missing key retains the previous snapshot and does not
fabricate jobs. Provider errors fail the run and retain the previous snapshot.
The UI warns when data is over 48 hours old, including between weekly refreshes.
For daily updates, change the cron in `.github/workflows/feed.yml` to
`17 3 * * *` after checking the provider quota.

The feed is a bounded snapshot, not a complete LinkedIn/Naukri mirror. It may
contain no Naukri results if the provider has none indexed for these searches.
Increase the page limit (maximum 3) or edit roles/countries to change coverage.
The search form filters the published snapshot; it does not change the scheduled
configuration or use your CV to make provider requests.

No paid hosting service or provider subscription is purchased by this project.
GitHub Actions/Pages and the provider are subject to their account limits.

## 4. Move your existing workspace

You can use RoleRadar before connecting a provider: import your CV, open a job
board using the shortcuts, then paste a posting URL into **Add a job** and select
**Fetch & add job**. Individual URL import uses Jina AI Reader without the feed
key; only the public posting URL is shared. If the page cannot be read, paste the
full job description manually. Import does not submit an employer application.
Matching, tracking, notes and evidence-based resume exports work without a key.
The online edition does not include generative AI rewriting.

In the old desktop app, use Connections & data > Export backup. In the online
app, use Import backup. Review your CV and saved jobs. The import merges new jobs
without overwriting existing records or your current CV. Backup files contain
personal data; keep them private and outside your repository.

No account-based cloud sync is included. Another device/browser starts empty.
Anyone using your browser profile can access its RoleRadar workspace. A public
job feed is not a private personal-search history; put only publishable role and
location searches in feed-config.json.

## Troubleshooting

- **Feed not connected:** check the secret name, run Refresh job feed, and inspect
  its result. The starter jobs.json intentionally has no live vacancies.
- **No matches:** choose Any time, All locations and All specialisms, clear the
  keyword box, and inspect the configured query coverage in Connections & data.
- **Python engine will not load:** allow requests to the pinned jsDelivr runtime,
  use HTTPS and a current browser, and reload. Your saved database is retained.
- **Data disappeared on another device:** import your private backup. There is no
  server-side personal database or automatic cross-device sync.
- **Pages fails:** ensure Actions is selected in Settings > Pages and the account
  permits Pages deployments. The repository alone does not serve this app.

References:
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://www.openwebninja.com/api/jsearch
- https://pyodide.org/en/0.29.4/usage/index.html
