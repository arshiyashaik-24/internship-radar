# Set up your own Internship Radar

About 10 minutes. You need a free GitHub account and nothing else: no server, no
database, no API keys, and no payment details.

Once it is set up, everything runs in **your** GitHub account:

- Every morning, GitHub's servers collect new student listings from the employers'
  official job systems.
- Your dashboard website updates itself.
- Your saved roles and notes stay in your own browser.

Nobody else needs to be involved.

---

## 1. Get your own copy

Pick the route that matches how you received Radar.

### Route A: you were sent a GitHub link

1. Sign in to GitHub. Create a free account at <https://github.com/signup> if you need one.
2. Open the link you were sent.
3. If you see a green **Use this template** button, click it and choose
   **Create a new repository**. If you only see **Fork**, click that instead.
4. Name it `internship-radar` and set it to **Public**.
   On a free account, GitHub Pages only works for public repositories. See
   [What is public](#what-is-public) below.
5. Click **Create repository**.

If you forked, open the **Actions** tab and click
**I understand my workflows, go ahead and enable them**. GitHub switches workflows
off in new forks until you do this.

### Route B: you were sent a zip file

1. Create a new **public** repository called `internship-radar` at
   <https://github.com/new>. Leave every box unticked.
2. Unzip the file on your computer.
3. On the new repository's page, click **uploading an existing file**.
4. Drag **everything inside** the unzipped `internship-radar` folder into the page,
   including the hidden `.github` folder. On a Mac, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd>
   in Finder to show hidden folders.
5. Click **Commit changes**.
6. Check that a `.github/workflows` folder appears in the repository. If it is
   missing, the browser skipped it:
   - Click **Add file → Create new file**.
   - Type `.github/workflows/radar.yml` as the name.
   - Paste in the contents of that file from the zip.
   - Commit.
   - Do the same for `tests.yml`.

## 2. Turn on the website

1. In your repository, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

There is nothing else to fill in on that page.

## 3. Run the first refresh

1. Open the **Actions** tab and click **Radar** in the list on the left.
2. Click **Run workflow**, then the green **Run workflow** button.
3. Wait 3–5 minutes for both steps to turn green.
4. Your dashboard is now at `https://YOUR-USERNAME.github.io/internship-radar/`.
   Bookmark it, and add it to your phone's home screen if you like.

From now on it refreshes by itself every morning at about 06:00 Dutch time.

If a step turns red, open it to read why. Radar still publishes whatever it could
collect, and the dashboard's **Sources and health** page shows which employer failed.

---

## Everyday use

| You want to… | Do this |
|---|---|
| See what is new | **Overview** lists new matches, programmes that opened, and upcoming deadlines. Click **Mark all as seen** when you're done. |
| Refresh right now | Click **Refresh now on GitHub** at the top of the dashboard, then **Run workflow**. |
| Shortlist a role | Click the bookmark on any role. Track its stage, dates and notes in the role's panel. |
| Back up your tracker | **Saved and applied → Export backup**. To move it to another device, use **Import backup** there. **Export CSV** gives you a spreadsheet. |
| Change hours, fields, locations or score weights | **Settings**. Changes apply right away in that browser. |
| Make your settings the default on every device | **Settings → Download preferences.json**. Then, in GitHub, open `config/preferences.json`, click the pencil icon, paste in the new contents and click **Commit changes**. |

### Add an employer

Open `config/sources.json` on GitHub and click the pencil icon. Copy an existing
block, change it, and click **Commit changes**. The next refresh picks it up.

Which block to copy depends on where the company's job links point:

| The job links go to… | Copy a block with this `type` | What to change |
|---|---|---|
| `job-boards.greenhouse.io/NAME` or `boards.greenhouse.io/NAME` | `greenhouse` | Set `token` to `NAME`. |
| `jobs.lever.co/NAME` (or `jobs.eu.lever.co/NAME`) | `lever` | Set `token` to `NAME`. Add `"region": "eu"` for the EU site. |
| `jobs.ashbyhq.com/NAME` | `ashby` | Set `token` to `NAME`. |
| `NAME.recruitee.com` | `recruitee` | Set `token` to `NAME`. |
| `COMPANY.wd3.myworkdayjobs.com/SITE` | `workday` | Copy the NXP block. Change `host`, `tenant` (the part before `.wd3`) and `site`. |
| Anything else | `manual` | It becomes a link you check yourself. |

Every block needs an `id` that no other block uses, for example `gh-mycompany`.
The **Tests** workflow tells you if the file has a typo.

### Record a programme's dates

Radar only shows confirmed dates when it has a source for them. If an employer
announces when applications open, you can record it:

1. Open `config/programmes.json` on GitHub.
2. Find the programme and fill in `announced` with the date and the link where you
   read it. The format is explained at the top of the file.

Radar also records the first day it sees each year's listings. After one year, it
uses those dates to estimate the next opening.

---

## What is public

Your dashboard address is public, but nobody will find it unless you share it.
Search engines are told not to list it.

| Public | Private, in your browser only |
|---|---|
| Job listings collected from public employer sites | Saved roles |
| The settings in `config/preferences.json`: fields of interest, study year, hours | Application stages and notes |
| | Any settings you change on the dashboard |

## If something stops working

- **"Data refreshed" is more than a day old.** Open the **Actions** tab.
  - If you see "This scheduled workflow is disabled", click **Enable workflow**.
    GitHub can pause schedules in repositories that have been inactive for 60 days.
    Radar's daily data commits should prevent that, but GitHub emails you if it
    happens.
  - Otherwise, open the latest run and look at the red step.
- **One employer shows "Failing".** Its job site changed or was temporarily down.
  Its old listings stay on the dashboard with a "not re-checked" label.
  - If it keeps failing for a week, set `"enabled": false` on its block in
    `config/sources.json`.
  - Then add it back as a `manual` source.
- **"Blocked by robots.txt".** The employer asked automated tools not to read that
  page. Radar respects that. Switch the source to `manual`.
- **Something is wrong on the dashboard itself.** GitHub emails the repository
  owner when a scheduled run fails, so you will usually know before you look.

## Getting improvements later

- **If you forked:** your repository page shows **Sync fork** whenever the original
  is updated. Click it, then **Update branch**. Your data and config are kept unless
  you edited the same files.
- **If you used the template or a zip:** your copy is independent. Updates have to
  be copied over by hand.
