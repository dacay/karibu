# Backend Scripts

All scripts are run from the `apps/backend` directory and require `DATABASE_URL` in your `.env`.

## Create Organization

Creates a new organization with an initial admin user.

```bash
pnpm db:create-org --name "Org Name" --subdomain acme --admin-email admin@acme.com --admin-password secret123
```

| Argument           | Description                          |
| ------------------ | ------------------------------------ |
| `--name`           | Organization display name            |
| `--subdomain`      | Unique subdomain for tenant routing  |
| `--admin-email`    | Email for the initial admin user     |
| `--admin-password` | Password for the initial admin user  |

## Add Admin

Adds an admin user to an existing organization (looked up by subdomain).

```bash
pnpm db:add-admin --subdomain acme --email admin@acme.com --password secret123
```

| Argument      | Description                              |
| ------------- | ---------------------------------------- |
| `--subdomain` | Subdomain of the target organization     |
| `--email`     | Email for the new admin user             |
| `--password`  | Password for the new admin user          |

## Seed Scripts

| Command                  | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `pnpm db:seed:dev`       | Seeds a demo org, admin, and learner for local dev |
| `pnpm db:seed:defaults`  | Seeds global defaults (built-in patterns, etc.)  |
| `pnpm db:seed:admins`    | Seeds admin users                                |
