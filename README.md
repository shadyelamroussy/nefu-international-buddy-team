# NEFU International — Real Platform V2

This package is a real working full-stack version of the Buddy Team concept,
not just an API mockup.

## Included

- Existing V3 prototype preserved under `prototype/`
- New working web app under `public/`
- Persistent SQLite database (`data/nefu.db`)
- Session-based login
- Student registration/login
- Buddy Team registration with `pending` approval
- Exactly two admin usernames: `shady` and `sargylana`
- Phone/number required for student and Buddy registration
- Student ID is not required
- Admin event create/delete
- Event cover photos
- Multiple event photos
- Student event registration
- Admin view of event registration lists
- Admin Buddy approval/rejection
- Admin website hero/main photo upload
- Student support requests
- Buddy request status + assignment
- English / Russian / Chinese site-wide UI dictionary
- Official NEFU International logo copied into the public site

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:
   `npm install`
4. Set two admin passwords (do not put them in the code):
   - Windows PowerShell:
     `$env:ADMIN1_PASSWORD="your-secure-password"`
     `$env:ADMIN2_PASSWORD="your-secure-password"`
   - macOS/Linux:
     `export ADMIN1_PASSWORD="your-secure-password"`
     `export ADMIN2_PASSWORD="your-secure-password"`
5. Run:
   `npm run setup-admins`
6. Start:
   `npm start`
7. Open:
   `http://localhost:3000`

Admin logins:
- `shady`
- `sargylana`

## Important production hardening

Before public deployment:
- set a strong `SESSION_SECRET`
- serve over HTTPS
- set secure cookies in production
- put uploads in private object storage if documents are added
- add rate limiting and audit logs
- configure backups
- use PostgreSQL for multi-instance production deployment if needed

The current SQLite database is persistent and fully usable for a single-server
deployment. A PostgreSQL migration can be added when the final hosting
environment is selected.


### V4 updates
- Login sessions are stored persistently in SQLite for up to 30 days, so users do not need to log in again after a server restart unless they log out or the session expires.
- Student, Buddy Team, and Admin dashboards open as full-page views after login.
- Event dates are displayed as DD/MM/YYYY HH:MM.
- Admin dashboard includes full lists of all registered students and all Buddy Team members, with profile/contact/status information and Buddy approval controls.
