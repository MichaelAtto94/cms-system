# Committee Governance System

Prepared for Mwale Michael • NIPA • BSc Computer Science • Student ID 2023000889

## What this system solves

The attached proposal identifies a governance gap: manual appointments lack recorded selection reasons, conflicts and term limits are missed, committee workload is uneven, and meeting evidence is scattered. This application connects member profiles, transparent ranking, independent appointment approvals, term reminders, meetings, attendance, minutes, actions, votes, versioned documents and designed institutional reports.

This is a runnable implementation of the core governance workflow, with source code and tests. It is not a certification of legal compliance or a completed implementation of every advanced feature listed in the proposal. The delivery matrix below makes those boundaries explicit.

## 1. Windows installation — simplest route

Use a Windows 11 PC with Internet access for the first dependency installation. Install Node.js 24 LTS from https://nodejs.org/en/download. You do not need Java, Android Studio, Redis, Docker or a separate PostgreSQL installation for this route.

1. Extract `CMS_Complete_Source.zip` on your Desktop. Keep the `cms-system` folder intact.
2. Open PowerShell and enter these commands:

```powershell
cd "$env:USERPROFILE\Desktop\cms-system"
node --version
npm.cmd --version
npm.cmd ci
npm.cmd run setup
npm.cmd run build
npm.cmd start
```

3. Open http://localhost:4000 in Chrome or Edge. Keep the terminal open.
4. Institution ID: `nipa`. Initial email: `admin@cms.local`. The setup command prints your randomly generated administrator password. Each installation receives its own password.
5. Save that password privately. The `.env` file also contains it for initial seeding. The application hashes the password in the database. After changing it through the interface, clear `ADMIN_PASSWORD` from `.env`; existing databases do not need that seed value.
6. Open Settings, change the institution name, upload a logo, and choose your font, primary colour, text size and spacing. Change your password.

There is also an automated script:

```powershell
cd "$env:USERPROFILE\Desktop\cms-system"
powershell -ExecutionPolicy Bypass -File .\Start-CMS.ps1
```

`ExecutionPolicy Bypass` applies to this process. Review the supplied script before running it. It installs locked dependencies, creates `.env` if missing, builds the interface and starts the application.

If you extracted into a different directory, change the `cd` path accordingly. Do not paste commands for an unrelated project.

## 2. Starting again and editing code

Normal use after installation:

```powershell
cd "$env:USERPROFILE\Desktop\cms-system"
npm.cmd start
```

Development with automatic refresh:

```powershell
npm.cmd run dev
```

Open http://localhost:5173 for development. The API runs on port 4000. Production-style local use uses the built interface on port 4000. After changing frontend source, run `npm.cmd run build` again before `npm.cmd start`. Stop either mode with Ctrl+C and wait for “Database safely closed.” Do not force-kill the process or power off during database startup/writes.

Your local data is stored in `data/postgres` and uploaded files in `data/documents`. Keep the entire `data` folder and `.env` together when moving this embedded installation to another PC. Never open the same embedded database from two application processes. An empty installation is deliberately not populated with fictional institutional records.

## 3. First successful governance workflow

### Accounts and separation of duties

Open Members and create at least two additional administrator accounts with separate email addresses. For the first demonstration, use three administrator accounts: proposer, reviewer and final approver. They have institutional visibility before any committee memberships exist. Use separate browser profiles or sign out between accounts. Create the ordinary member candidates too.

An administrator controls institution-wide records. Chairperson and Secretary accounts must have current approved committee appointments before they can manage that committee. Member accounts see their current committees, can declare conflicts, vote and complete their assigned actions. Viewer accounts have read access only to committees where they have a current allocation. A committee appointment role is recorded separately from the user's system access role; administrators should align the two when appointing officers.

### Create a committee

Open Committees → New committee. Enter a real mandate, type, comma-separated expertise requirements, seat count, term duration, maximum terms and required quorum. These are institutional policy settings, not automatically inferred legal requirements. A quorum cannot exceed the configured seat count. Add a parent committee if needed; avoid circular parent structures.

### Select members fairly

1. Ensure profiles contain skills, department and availability.
2. Record relevant conflict declarations before proposing appointments. Administrators can record declarations for candidates who are not yet appointed.
3. Open the committee → Rank candidates.
4. Review the score, workload, gender and department. Gender and department are displayed for human composition review; the engine does not automatically enforce a legal quota.
5. Select an eligible candidate, choose the committee role and term dates, and save the proposal.
6. A different officer reviews the proposal with a reason.
7. A third independent administrator or chairperson approves it with a reason.
8. Check that the status is ACTIVE. Until final approval, the appointment gives no committee access.

The algorithm scores exact, case-insensitive comma-separated skill matches (maximum 60), current appointment workload (30 minus 10 for each active appointment, minimum zero), and availability (10). Unavailable candidates, active conflict declarations, duplicate pending/current appointments and exhausted term limits block selection. Ranking is deterministic decision support. The AI integration does not select or approve people.

Term dates must fit the configured duration. Final approval rechecks eligibility and available seats. End a term explicitly to preserve its history; do not delete governance records. The minute-level scheduler sends deduplicated notices at 90/60/30-day windows and after expiry. Reminders start when the running application enters each window, not on an exact midnight timetable.

### Hold and document a meeting

1. Open Meetings → Schedule meeting. Date/time inputs use Zambia's CAT, UTC+02:00.
2. Enter agenda items, venue or video meeting URL, and a future time.
3. The server checks current invitees for other committee meetings within one hour. This is a fixed conflict window; no duration or calendar-provider integration is included.
4. Invitations appear in Notifications and the email queue.
5. Open the meeting and mark each allocated member present or absent.
6. Assign actions with an owner and deadline. The owner must be a current committee member.
7. Record minutes, save as DRAFT, then SUBMITTED.
8. An independent chairperson or administrator approves the submitted text. Approval requires recorded quorum and preserves the exact submitted minutes. Approved minutes are locked; record corrections in a subsequent meeting.
9. Create a motion and closing time if a recorded vote is needed. Current appointed members can vote once. Active conflicts prevent voting. This is an attributed ballot, not a secret ballot.

## 4. Branding, fonts, light/dark mode and sizing

Settings controls institutional name, PNG/JPEG logo under 1 MB, primary colour, interface font (Arial, Georgia, Verdana or Trebuchet MS), 12–20 px interface text, Comfortable/Compact spacing, report footer and AI enablement. The moon/sun button changes dark/light mode and persists on that browser.

The interface includes responsive sidebar navigation, overview statistics, committee coverage bars, member workload bars, search, permission-aware controls, dialogs, notifications and email delivery status. Mobile navigation opens through the menu button. Institutional logo and colour are also used in PDF reports. PDFs use standard readable fonts; interface font selection does not embed arbitrary fonts into PDF. Excel reports include styled headings, frozen headers, filters, wrapping, alternating rows and print settings.

## 5. Document repository

Assigned officers and administrators can upload PDF, DOCX, XLSX and plain TXT files up to 10 MB. Use the same title and committee to create another version. STANDARD documents are available to current committee members; CONFIDENTIAL documents require assigned officer or administrator access. Downloads require authentication and are audited.

File type checks validate a PDF signature, ZIP container plus Office extension, or plain text. They do not replace antivirus scanning or deep Office format verification. Public production deployment should add malware scanning. Document version numbers are allocated transactionally. There is no document deletion endpoint or public upload directory.

## 6. Designed reports

Open Reports, select the institution or committee scope, then download PDF or Excel:

- Governance overview: seat coverage, expired active appointments, open conflicts, past meetings without approved minutes and overdue actions.
- Attendance register: recorded attendance. Unrecorded members are not falsely classified as absent; record attendance before exporting.
- Workload and composition: current appointment counts, departments, declared gender and committee roles.
- Meeting record book: agendas, minutes, dates and approval status.
- Audit evidence: institutional action history, actor IDs, timestamps and recorded details.

Reports use CAT timestamps and include the institutional identity, generation time and page numbers. Sample PDFs in `sample-reports` contain fictional test fixtures and demonstrate formatting only. Do not submit them as institutional evidence.

Governance findings are evidence prompts, not a ZPPA/HEA compliance certificate. Map these checks to verified current institutional policies with your supervisor or governance office before regulatory use. The proposal's references and numerical claims were not independently verified during this implementation.

## 7. Email — local capture and real delivery

In-system notifications work immediately. External email requires SMTP credentials. Email records are queued, retried at five-minute intervals, and marked FAILED after five attempts. Settings displays the latest 100 delivery records and offers Retry after configuration is corrected. The worker runs every minute while the server is running. No external mail is sent by the test suite.

### Local email capture with Docker

Install and open Docker Desktop, then run:

```powershell
docker compose up -d mailpit
```

Keep the default `.env` settings: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`. Open http://localhost:8025 to inspect captured emails. Restart the application after changing `.env`. Settings → Send test email sends to the signed-in administrator.

Without Mailpit or a real SMTP server, email delivery attempts will fail visibly while in-system notifications continue to work. Do not claim delivery merely because an item is queued.

### Real SMTP

Edit `.env` with Notepad:

```powershell
notepad .env
```

Use the exact values supplied by your provider:

```text
SMTP_HOST=your-provider-smtp-host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email-or-provider-username
SMTP_PASS=your-provider-app-password
MAIL_FROM=Committee Office <your-verified-sender@example.com>
```

Port 465 normally uses `SMTP_SECURE=true`. Port 587 normally uses STARTTLS with `SMTP_SECURE=false`. Verify these settings with your provider. Restart and send the test email. A successful SMTP submission does not guarantee inbox arrival; your provider's domain verification, SPF/DKIM and delivery policies still apply. Keep `.env` out of GitHub.

## 8. Officer two-factor verification

Only after email testing succeeds, change `REQUIRE_2FA=true` in `.env` and restart. Administrator, Chairperson and Secretary logins then require a six-digit email code. Codes expire after five minutes, permit at most five attempts and are held in process memory. Restarting cancels pending challenges. This is email-based second-step verification, not authenticator-app TOTP. The local development default is false to avoid locking out a first installation before SMTP exists.

## 9. AI integration

The application uses the OpenAI Responses API from the backend. An API account with billing/model access is required; a ChatGPT subscription does not supply this application's API key. Never place your key in frontend code or send it in chat.

1. Create an API key in your provider account.
2. Edit `.env`: `OPENAI_API_KEY=your-key`. Set `OPENAI_MODEL` to a Responses-compatible model available to your account. The shipped default is `gpt-4.1-mini`.
3. Restart the server.
4. Settings → Allow AI to process meeting text → Enabled. Enable only when your institution permits that text to be sent to the provider.
5. Open a meeting with recorded minutes and select Generate draft summary.
6. Review the draft. It is displayed separately and is never automatically saved as minutes or turned into approved actions.

The provider receives the selected meeting title, agenda, minutes and instruction only. Requests use `store:false`, a 45-second timeout and a per-IP rate limit. This setting does not override the provider's retention policies. Users need an assigned officer role or institution administrator access. Missing credentials or disabled AI produces an explicit configuration message. Live AI output was not tested with a paid user account; the unavailable-provider path is tested.

## 10. Offline reading and installable shell

The built application includes a manifest and service worker that caches the public interface shell only. It does not cache API responses, documents or exported reports. Browsers supporting the manifest can install the application as a PWA; install prompts vary by browser.

In Settings, a user can opt in to offline reading on a trusted browser tab. This saves a private state snapshot in sessionStorage. On network failure, that snapshot becomes read-only with a visible warning. It lasts for that tab/session and is cleared on online logout. Do not enable it on shared computers. Offline mode cannot verify revoked permissions until reconnection. No offline edits or conflict synchronization are implemented. Opening a completely new offline session with no saved tab snapshot will not give access to institutional data.

## 11. Full PostgreSQL and Docker route

Embedded PGlite runs PostgreSQL semantics locally and removes database installation friction. For shared institutional deployment, use the supplied PostgreSQL 17 Docker service or a maintained external PostgreSQL instance. This route is optional for the first PC.

1. Install Docker Desktop and start its Linux engine.
2. Run `npm.cmd run setup` once if `.env` does not exist. Setup creates a random `POSTGRES_PASSWORD` too.
3. From the project directory:

```powershell
docker compose up -d --build
```

4. Open http://localhost:4000 and http://localhost:8025. First build requires Internet.
5. To inspect:

```powershell
docker compose ps
docker compose logs --tail=100 app
```

6. Stop without erasing data:

```powershell
docker compose down
```

The Docker route has its own PostgreSQL volume and uploaded-file volume. It does not automatically migrate the embedded database. Choose the database route before adding real institutional data. Do not run `docker compose down -v` unless you intend to erase the Docker data.

To use installed PostgreSQL outside Docker, create a database and login, set `DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE` in `.env`, and start the application. URL-encode special characters in credentials. Use a dedicated account, not the cluster superuser. The schema initializes on startup. Existing records are preserved.

The supplied Compose configuration binds local ports to 127.0.0.1 and uses HTTP/local-development cookies. It is not a public HTTPS deployment. For production, add a TLS reverse proxy, set `NODE_ENV=production`, configure HTTPS, restrict database/network access and use a limited runtime database role separate from migration ownership. A database owner can disable audit protections; database-level immutability is not immunity from DBA tampering. Validate backup restoration, institutional permissions and load before rollout.

## 12. Backup, restore and another PC

Embedded route, while the server is stopped:

```powershell
npm.cmd run backup
```

The backup includes a JSON snapshot of all application tables and uploaded documents. It contains private records and password hashes. Protect it and store a copy outside the PC. It excludes `.env`, so back up your configuration separately and securely.

Restore to a new, empty embedded data directory:

```powershell
$env:DATA_DIR=".\restored-data"
node scripts/restore.js "backups\YOUR-SNAPSHOT-FOLDER"
Remove-Item Env:DATA_DIR
```

Set `DATA_DIR=./restored-data` in `.env` before starting if this is the database you want to use. Restoration intentionally refuses a nonempty database. Run backup only while the application is stopped so documents and table data form a coherent snapshot. Automatic daily backup scheduling is not included; use Windows Task Scheduler or your institutional backup platform after defining a maintenance window.

Docker route:

```powershell
docker compose stop app
docker compose exec postgres sh -c 'pg_dump -U cms -d cms > /tmp/cms.sql'
docker compose cp postgres:/tmp/cms.sql .\cms-backup.sql
# Also copy uploaded documents from the stopped application container.
docker compose cp app:/app/data/documents .\documents-backup
docker compose start app
```

Keep the SQL dump and documents together. Test recovery into a separate database before relying on the backup. Docker restore is an administrator operation: import the SQL dump into an empty database using `psql`, restore the documents volume, and only then start the app.

On a new PC, install Node 24, copy the source (not node_modules), configuration and data/backup, run `npm.cmd ci`, `npm.cmd run build`, then `npm.cmd start`. Do not run setup over an existing `.env`; the supplied setup preserves it.

## 13. Tests and acceptance

```powershell
npm.cmd test
npm.cmd run build
```

Browser smoke checks also passed login, committee creation, page navigation, branding changes, light/dark mode, a 390 px mobile viewport without horizontal overflow and the candidate dialog with no runtime errors.

The tests use temporary databases and an isolated local SMTP server. They cover deterministic allocation scoring, conflict and tenure exclusions, workload weighting, warning windows, database append-only enforcement, transaction rollback, independent approvals, tenant isolation, role restrictions, email verification and test delivery, locked minutes, uploads/download permissions, actions, one-member-one-ballot, PDF/Excel generation, unavailable AI and password-based session revocation and persistence after a graceful restart.

They are not a coverage measurement or a load test. The proposal's 70% coverage, 200 concurrent users, under-3-second response, 99% uptime, OWASP compliance and SUS ≥70 targets have not been proven. PostgreSQL-container execution and external paid AI/SMTP providers require environment-specific validation. Carry out UAT with administrators, secretaries, chairpersons and members. Measure successful tasks, response times and SUS scores rather than describing targets as achieved.

Acceptance demonstration: create three officer accounts; create committee; rank candidates; show a conflict blocking nomination; resolve with recorded evidence; propose, independently review and approve; schedule a meeting; record attendance; submit and approve minutes; assign and complete an action; cast a vote; upload two document versions; export each report; change branding and dark mode; verify Mailpit delivery; inspect the audit trail. Review on Windows desktop and your Samsung phone after a deliberate HTTPS/LAN deployment.

## 14. Delivery matrix and remaining implementation

| Proposal / requested capability | Delivered behaviour | Boundary / next work |
|---|---|---|
| Login and RBAC | Cookie-based JWT, bcrypt, five access roles, revocable sessions, email verification option | SSO and authenticator TOTP are not implemented |
| Member profiles | CRUD, skills, department, gender, availability, activation | HRIS import connector and self-service onboarding need implementation |
| Committee governance | ToR, seat limits, term limits, quorum, parent, archive | Template library and formal policy-change approval workflow need implementation; ToR edits are preserved in audit evidence |
| Fair allocation | Explained ranking, conflicts, workload, tenure, three-person approval | Configurable weighting UI and automatic equity quotas are not included |
| Term tracking | History, expiry visibility, 90/60/30/expired notification windows | Automatic successor appointment is intentionally not performed |
| Meetings | Agenda, conflict window, attendance, minutes approval, actions and attributed voting | Calendar integrations and richer availability calendars need implementation |
| Documents | Authenticated uploads/downloads, versions, Standard/Confidential access | Certificate-backed digital signatures, expiry dates, antivirus and full-text Office search need implementation |
| Notifications / email | In-system inbox, bulk committee communication, SMTP queue, retries and delivery view | SMS provider adapter and per-user notification preferences need implementation |
| Reporting | Five designed PDF/Excel types with committee scope and branding | Arbitrary custom report builder and scheduled email distribution need implementation |
| AI | Server-side OpenAI drafting integration, permission checks, opt-in and separate draft display | Provider key/billing and live institution-approved tests required |
| Branding and accessibility | Logo, colour, fonts, text size, spacing, light/dark mode, responsive layout | Keyboard/screen-reader and low-vision UAT remains necessary |
| Audit | Append-only DB trigger, user/IP/time/action/evidence, export | External tamper-evident archival recommended for independent oversight |
| Multi-institution foundation | Tenant columns and scoped API queries; login accepts institution ID | UI self-service tenant provisioning and stronger PostgreSQL RLS policies need implementation |
| Offline / PWA | Public shell caching, opt-in read-only tab snapshot | No offline edits or synchronization |
| Operations | Docker/PostgreSQL, local embedded mode, backup and restore scripts | Redis, TLS/load balancer, continuous backup automation, monitoring, horizontal worker coordination and public hosting are not configured |

Complete these remaining items as subsequent documented increments rather than representing this first version as fulfilling every advanced promise in the proposal. In particular, genuine PKI digital signing and regulator mappings require verified institutional requirements and an appropriate provider; a stored approval is not a certificate-backed signature.

## 15. Project structure

```text
client/              React interface, styling and public PWA shell
server/index.js      Authenticated REST API and business workflows
server/db.js         Embedded/external PostgreSQL adapter and transactions
server/schema.sql    Relational schema, constraints and immutable audit trigger
server/governance.js Explainable candidate ranking and tenure windows
server/mail.js       SMTP transport, notification queue and reminder worker
server/reports.js    Designed PDF and Excel exports
server/seed.js       Initial institution and administrator
scripts/             Safe first setup, backup and empty-database restore
tests/               Governance, persistence and API integration tests
Start-CMS.ps1        Windows setup/build/start script
Dockerfile           Reproducible Node application container
docker-compose.yml   PostgreSQL, application and local SMTP capture
```

## 16. API overview

All endpoints except `/api/health`, `/api/login` and `/api/login/verify` require the HttpOnly session cookie. Mutations require `X-CMS-Request: 1`. Browser clients use same-origin requests. The tenant comes from the authenticated user, not a body parameter.

| Area | Routes |
|---|---|
| Session | POST login, login/verify, logout, password; GET me/state/health |
| Profiles | POST users; PATCH users/:id |
| Committees | POST committees; PATCH committees/:id; GET committees/:id/rank |
| Conflicts | POST conflicts; POST conflicts/:id/resolve |
| Allocation | POST allocations; POST allocations/:id/decision |
| Meetings | POST meetings; PATCH meetings/:id; POST attendance/actions/votes |
| Decisions | PATCH actions/:id; POST votes/:id/ballot |
| Documents | POST documents (multipart); GET documents/:id/download |
| Communication | POST communications; POST notifications/read; POST outbox/:id/retry |
| Settings | PATCH settings; POST integrations/email-test |
| AI | POST ai |
| Reports | GET reports/:type/:format?committee_id=ID |

These are integration primitives, not a finished public HRIS/ERP connector. There is no long-lived API-key management interface.

## 17. Troubleshooting

- `node` not recognized: install Node 24 LTS and reopen PowerShell.
- PowerShell blocks `npm.ps1`: use the supplied `npm.cmd` commands.
- Missing administrator password or invalid JWT secret: run `npm.cmd run setup` on a new installation, or repair the existing `.env`. Never regenerate credentials casually for a populated installation.
- `EADDRINUSE`: stop the other server using port 4000. If changing `PORT`, update the Vite proxy too for development.
- Blank/old interface: build again; clear the site service-worker/cache after an upgrade. The service worker cache key should be bumped for future releases.
- Cannot see a committee: verify a current approved allocation, term start/end, active account and access role.
- Cannot approve: three separate officers are required. For initial bootstrap, use three administrator accounts. Submitted minutes need an independent approver and recorded quorum.
- Conflict still blocks: administrator must resolve the declaration with evidence. It cannot be bypassed by selecting a higher score.
- Email queued/failed: start Mailpit or configure real SMTP; inspect Settings delivery queue and the server terminal. Restart after editing `.env`.
- AI unavailable: key, model access, billing, institutional opt-in and committee permissions must all be present.
- Docker named-pipe error: start Docker Desktop and wait for its Linux engine before running Compose.
- Need a reset: use a separate new data directory for experiments. Do not erase an institution's data folder or Docker volumes.

## Technical references

Node.js LTS downloads: https://nodejs.org/en/download
Nodemailer SMTP transport: https://nodemailer.com/smtp
OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
PGlite: https://pglite.dev/
PostgreSQL documentation: https://www.postgresql.org/docs/

Dependencies are resolved in package-lock.json. First installation uses `npm ci` for reproducibility. Before institutional production release, review dependency advisories and apply compatible updates with regression testing.
