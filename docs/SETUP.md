# Setup guide

This guide takes you from a copy of the exported `web-guardian` repository to a live instance: a scheduled GitHub Actions run that publishes a Dashboard and a Virtual Office on your own GitHub Pages site. Examples use `example.com`, `example-owner` and `example-repo`. Replace them with your own values.

The export contains the engine, the console, the workflow and example configuration only. It has no baselines, no run data and no site settings. You create those in the steps below.

## Prerequisites

- Git, with `user.name` and `user.email` set (the console needs them to publish).
- Node 22. The version is pinned in `.nvmrc`. With nvm: `nvm install` then `nvm use`.
- A GitHub account that can create repositories and sign in with git from your terminal (a credential manager, an SSH key or a personal access token). The token or key must be allowed to push to `main` and to change files under `.github/workflows/`.
- Windows, macOS or Linux. The commands below work in PowerShell, bash and zsh.

## 1. Create your repository

Create a new, empty repository on GitHub and push the export to it. Do not use the Fork button.

The workflow skips every job when the repository is a GitHub fork (`!github.event.repository.fork`). A fork shows a green or empty Actions page, never runs, and never publishes. A new repository made from the export does not have this problem.

1. On GitHub choose **New repository**. Name it, for example, `example-repo`. Leave "Add a README", `.gitignore` and licence unchecked so the repository is empty. Public or private both work (see [Costs and limits](#costs-and-limits)).
2. In the folder that holds the export, point git at the new repository and push `main`:

```bash
git remote remove origin          # only if the export already has an origin
git remote add origin https://github.com/example-owner/example-repo.git
git branch -M main
git push -u origin main
```

The console publishes to the remote named `origin`, branch `main`, so keep those names. The push contains the workflow file, so GitHub may start a first run. That run has no configuration to work with and can fail. You can ignore it.

## 2. Enable Actions and Pages

In your repository on GitHub:

1. **Settings > Actions > General**: allow actions to run. If your organisation restricts the permissions of the workflow token, allow read and write. The `commit-runs-data` job needs `contents: write` to push run data.
2. **Settings > Pages**: set **Source** to **GitHub Actions**. Do not choose "Deploy from a branch". The `publish` job deploys the site with `actions/deploy-pages`, which only works with this source.
3. If you protect `main` with branch rules, the console cannot push to it directly. Either allow the account you publish with to push to `main`, or leave `main` unprotected.

You do not create the `runs-data` branch yourself. On the first successful run, the `commit-runs-data` job creates it as an empty (orphan) branch and adds the run to it. Before then, the restore steps report `first-run`, which is expected.

## 3. Install

```bash
npm ci
npm run build
```

`npm ci` installs the exact versions in `package-lock.json`. `npm run build` compiles TypeScript into `dist/`. The console runs from `dist/`, so build before starting it, and build again after you change anything under `src/`.

Page discovery and screenshot capture on your computer use a Chromium browser driven by Playwright. Install it once:

```bash
npx playwright install chromium
```

On Linux you may also need system libraries: `npx playwright install --with-deps chromium`. Without the browser, "Find pages" stops with a message that tells you to run this command.

## 4. Configure

Create your configuration files from the examples:

```bash
npm run init-config
```

This copies each `*.example.json` under `config/` and `config/domains/` to the same name without `.example`. It never overwrites a file that already exists. You now have `config/app.config.json`, `config/page-seed.json` and `config/domains/example-com.json`.

Edit these for your site. Use your own host name where this guide says `example.com`, and a short slug such as `example-com` (lowercase letters, digits and hyphens).

**config/app.config.json**

| Setting | Meaning |
|---|---|
| `approvedDomain` | The one host the Guardian may visit, for example `www.example.com`. |
| `baseUrl` | The site's base address, for example `https://www.example.com`. |
| `domain` | The slug. It must match the name of your file in `config/domains/`. |
| `seedFilePath` | Leave as `config/page-seed.json`. |
| `displayTitle` | Optional. A title shown in the console and Dashboard. |
| `limits` | Politeness and size limits. See below. |
| `retention` | `maxRuns` and `maxAgeDays` for run folders kept on your computer. |
| `viewports` | Desktop and mobile sizes used for screenshots. |

The defaults in `limits` are deliberately gentle: `concurrency` 1, `requestSpacingMs` 1000, `pages` 10, `crawlDepth` 2. `runTimeoutMs` is the run's own time limit; the workflow separately stops the job after 30 minutes. Raise `pages` and `maxApprovedPages` only if you need more pages. Every extra page adds screenshots, run time and repository size.

**config/domains/<slug>.json**

Rename the example file, then edit it:

```bash
mv config/domains/example-com.json config/domains/example-site.json   # use your slug
```

Set `domain` and `baseUrl` to your host, and change `scopeFile` to `config/scope/<slug>.approved.json`. Keep `approvedSchemes` as `["https"]` unless your site needs otherwise. `probePaths` lists the paths discovery tries first. A file left over as `example-com.json` counts as a second configured domain, so rename it rather than copying it.

**config/page-seed.json**

`approvedUrls` is the list of pages the Guardian may check, and `maxUrls` is the most it allows. Put your home page here, for example `https://www.example.com/`, and add the rest in the console (step 6). Every URL must be on `approvedDomain`.

If a required setting is missing or has the wrong type, the engine stops and names the setting and the example file to compare with.

## 5. Start the console

```bash
npm run console
```

Open http://127.0.0.1:7787/ in your browser. The console listens on your own computer only and has no sign-in because nothing else can reach it. Stop it with Ctrl+C.

The sections are Overview, Domain, Approved URLs, Discovery, Baselines, Findings and decisions, Publish, Schedule, Runs and logs, and Setup activity. Each action that changes anything asks for a **Reviewer name**. The name is recorded in the setup activity log and, for a publish, in the commit message on GitHub, which can be public. The console has no AI and sends nothing anywhere except your own git remote.

Overview shows the monitored site, how many URLs are approved, what would be published and the address of your live site.

## 6. Add the domain and approve URLs

For your first site, step 4 has already set the domain. The **Domain** section shows it as "The Guardian currently monitors: ...". Use the **Set up a new site** flow in that section later, when you want to switch to a different site. It is a four-step draft that leaves the current site unchanged until you confirm.

To approve pages:

1. Open **Approved URLs** and use **Add a web address** to add one or more addresses on your approved domain. Changes are staged first. Choose **Update project** to write them to `config/page-seed.json`.
2. Or open **Discovery** and choose **Find pages**. The console looks at your site from your computer, one request at a time with the configured spacing, and lists candidate pages. Tick the ones you want and choose **Approve selected**.

The list stays within `maxUrls`. The console shows how many of the allowed URLs are used. A page shows "Ready to scan?" only after it has an approved baseline.

## 7. Capture and approve baselines

A baseline is the human-approved reference that each run compares against. Nothing becomes a baseline until you approve it.

1. Open **Baselines**. Enter your Reviewer name.
2. Choose **Write spec drafts**. The console writes a text description of each approved page. Read each proposed draft and choose **Approve** for the ones that are right.
3. Choose **Capture screenshots**. Desktop and mobile screenshots of each page are taken. Open each proposal, compare it with what you expect, and approve the good ones. Choose **Approve selected** to approve several at once.
4. The readiness table shows, for each page, whether the spec, the desktop screenshot and the mobile screenshot are approved. A page is **Ready** when all three are.

Screenshots taken on your computer can differ slightly from those taken on the GitHub runner, because fonts and rendering differ between operating systems. After your first cloud run you can open **Runs and logs**, choose **Pull runs from GitHub**, and then use **Use the cloud run's screenshots** in Baselines to approve the runner's own screenshots as visual baselines. That avoids false differences.

Baselines are written to `baselines/` and `baselines-visual/`.

## 8. Publish

Everything so far changed files on your computer only. **Publish** sends them to GitHub.

1. Open **Publish**. It lists the files that would be sent: `config/app.config.json`, `config/page-seed.json`, `config/domains/`, `baselines/`, `baselines-visual/` and the workflow file. Check the list.
2. Enter your Reviewer name and tick the confirmation. If files will be deleted, or you are adding a large amount of baseline images, tick the extra acknowledgements the form asks for.
3. Choose **Publish to GitHub**.

The console makes one commit on top of `origin/main` that contains only those files, and pushes it with your own git sign-in. It never forces a push, rebases or switches your branch. It does not store a GitHub token. If the push fails, the page says why. The usual causes are:

- Not signed in: run `git push` once in a terminal, sign in, then retry.
- Your sign-in cannot change workflow files: update its permissions.
- `main` is protected: see step 2.
- GitHub has newer changes to the same files: run `git pull`, then publish again.

Raw git output is shown under **Git feedback**.

The push changes `config/**`, `baselines/**` or `baselines-visual/**` on `main`, and the workflow starts on any such push. That is how a publish starts a run. If nothing changed, **Publish** says "Nothing to publish" and no run starts. Pull requests only run the platform check (build and tests on Linux and macOS), never the scan or publish jobs.

## 9. First run

Publishing starts the first real run. You can also start one by hand:

1. On GitHub open **Actions > Web Guardian > Run workflow** and choose `main`.
2. Wait for the jobs `run`, `publish` and `commit-runs-data` to finish. A manual run also starts `verify-platform` on Linux and macOS.
3. Open your site: the Dashboard at `https://example-owner.github.io/example-repo/` and the Virtual Office at `https://example-owner.github.io/example-repo/office/`. The Overview section of the console shows the same links.

The first deploy of a Pages site can take a few minutes. After later deploys, hard refresh the page (Ctrl+Shift+R, or Cmd+Shift+R on macOS) because browsers and the GitHub CDN may keep the old version for about 10 minutes.

Review findings in **Findings and decisions** after you pull the run (**Runs and logs > Pull runs from GitHub**). A decision is saved on your computer. **Sync now** pushes your decisions to the `runs-data` branch so the next run applies them.

## 10. Schedule

The workflow runs daily at 17:00 UTC. Change it in the **Schedule** section:

1. Enter five cron fields (minute, hour, day of month, month, day of week) in UTC, for example `0 2 * * 1-5` for 02:00 UTC on weekdays. The console rejects gaps shorter than 5 minutes and warns that a schedule at minute 0 may be delayed at busy times.
2. Enter your Reviewer name and choose **Save schedule**. This edits the one `cron` line in `.github/workflows/guardian.yml` on your computer.
3. Go to **Publish** and publish. The new schedule takes effect on GitHub only after that.

The workflow file is the only place the schedule lives. GitHub may delay a scheduled run, and see its documentation for what happens to scheduled workflows in repositories with no recent activity.

## Costs and limits

**GitHub Actions minutes.** Standard GitHub-hosted runners are free for public repositories. Private repositories use the minutes included in your plan, then bill for more, and macOS runners use minutes at a higher rate than Linux. Check your plan on GitHub. One scheduled run uses the `run` job (up to 30 minutes), the `publish` job (up to 10) and the `commit-runs-data` job (up to 15), all on Linux. A pull request, or a manual run, also starts `verify-platform`, which runs the build and tests on one Linux and one macOS runner (up to 20 minutes each). To use fewer minutes, approve fewer pages, run less often, or use pull requests sparingly if your repository is private.

**Run time.** The `run` job stops after 30 minutes. The engine's own `limits.runTimeoutMs` is shorter, and each page waits at least `requestSpacingMs` between requests, so run time grows with the number of approved pages.

**GitHub Pages.** Pages has a published-site size limit and a bandwidth limit, and availability for private repositories depends on your plan. See the GitHub Pages documentation for current values. The workflow also runs `scripts/check-site-sizes.mjs` before deploying. It fails the run if the `office/` folder is over 1,572,864 bytes in total, or if any `data/runs/<run>/events.json` is over 262,144 bytes. A failed check stops the deploy, so the previous site stays online.

**Repository size and baselines.** Visual baselines are PNG files committed to `main`, one per page and viewport. They stay in git history even after you delete them. The Publish page warns before you add a large amount of images and blocks any single file over 50 MB.

**runs-data growth.** Every run adds a full run folder (screenshots, traces, accessibility results, logs) to the `runs-data` branch, which keeps only additions. Nothing removes old runs from it. Run folders can be large: on one local sample with about ten pages each folder was roughly 50 MB. Expect size to grow with pages, viewports and run frequency. Raw run artifacts never go to `main`.

`retention.maxRuns` and `retention.maxAgeDays` apply to run folders on your computer at the end of a local run. They do not prune `runs-data`.

**Pruning runs-data safely.** Use a normal commit. Do not force push or rewrite history.

```bash
git clone --branch runs-data --single-branch https://github.com/example-owner/example-repo.git runs-data-tidy
cd runs-data-tidy
git rm -r artifacts/runs/<old-run-id>        # repeat for each run you want to drop
git commit -m "Remove old runs"
git push origin runs-data
```

Keep `artifacts/a11y-history.json` and `artifacts/dispositions.json` on that branch. Each run you remove also leaves the Dashboard's run list and trend on the next deploy, because the workflow restores the runs on the branch before it builds the site. Deleting files makes later checkouts smaller but does not shrink the repository's history on GitHub. If you need the history itself to shrink, GitHub documents ways to do that, and they rewrite history, so read them first.

## Troubleshooting

- **The workflow never runs, and the Actions page is empty or green.** Check that the repository is not a GitHub fork. Create a new repository and push the export to it (step 1). Also check that Actions are enabled (step 2).
- **The Dashboard shows an old version after a deploy.** Hard refresh and wait up to about 10 minutes for the cache to clear.
- **The Pages deploy fails, or the site is missing.** Check that **Settings > Pages > Source** is **GitHub Actions**.
- **A run fails with a message about a required setting.** The message names the setting and the example file to compare with. Run `npm run init-config` if the file is missing, then fix the value.
- **A script says `skipped: no instance data`.** The script found no config, baselines or published data. This is normal in a fresh copy before your first run. The workflow itself requires the data and fails instead of skipping.
- **Find pages says the browser is not installed.** Run `npx playwright install chromium`.
- **The console page does not load, or it shows old behaviour.** Run `npm run build`, then start `npm run console` again.
- **Publish says there is no GitHub remote named origin.** Add it as in step 1 and make sure `main` exists on GitHub.
- **Publish says to set your git name and email.** Run `git config user.name "Your Name"` and `git config user.email "<your email address>"`.
- **`commit-runs-data` fails to push.** Check the workflow token setting in step 2 and any branch rule that covers `runs-data`.
