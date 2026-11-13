# EC-Server

Express API for the EC e-commerce demo. PostgreSQL stores relational data, MongoDB stores products and reviews, and Redis stores temporary data such as carts and sessions.

## Requirements

- Node.js 24.22.1 or later in the 24.x line
- PostgreSQL, MongoDB, and Redis

## Run locally

```bash
npm ci
cp .env.example .env
npx prisma migrate deploy
npm run seed
npm run dev
```

Fill in `.env` with your own database addresses and secrets before starting the API. The Elasticsearch connection is optional; search falls back to MongoDB. Cloudinary credentials are needed for uploads, and Resend credentials are needed for email.

The single Prisma baseline creates the schema on a new PostgreSQL database. The existing development database has already been marked as having applied that baseline. Create a new migration for future schema changes.

## Checks

```bash
npm test
npm run test:integration
```

Integration tests require Redis. Payment auto-confirmation is for demonstration and does not verify a real bank transfer.

The local `scripts/` directory is intentionally excluded from this repository. The `db:index-*` package commands reference that directory and are unavailable in a fresh clone.
