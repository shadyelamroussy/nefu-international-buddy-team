# NEFU International — Production Deployment

## Recommended setup
This build is ready for a single-server deployment using SQLite + persistent storage.

### Railway
1. Create a new Railway project and deploy this folder/repository.
2. Add a Volume to the service and mount it at `/data`. Railway volumes persist data across deploys/restarts.
3. Set environment variables:
   - `NODE_ENV=production`
   - `DATA_DIR=/data/nefu`
   - `UPLOAD_DIR=/data/uploads`
   - `SESSION_SECRET=<long-random-secret>`
   - `ADMIN1_PASSWORD=<private-password>`
   - `ADMIN2_PASSWORD=<private-password>`
4. Generate a public domain for the service.
5. After the first deployment, run `npm run setup-admins` once in the service shell if the admin accounts do not already exist.

### Render
The included `render.yaml` configures a Docker web service, `/health` health check, generated session secret, admin password secrets, and a 1 GB persistent disk mounted at `/data`. A persistent disk is required because SQLite and uploaded images must survive deploys/restarts.

### Important
- Never put admin passwords into the source code or Git repository.
- Keep `SESSION_SECRET` private.
- The database and uploads live under the persistent volume.
- Use HTTPS/public domain for the final submission.
