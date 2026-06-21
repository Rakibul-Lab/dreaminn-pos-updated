# DreamInn PMS

Hotel + Restaurant PMS built with Next.js and Prisma (MySQL).

## Features (current)

- Rooms & room types
- Bookings: reserve, check-in, check-out, cancel, adjust stay
- Billing: invoices, payments, deposits, company ledger
- Restaurant POS + kitchen flow + dues transfer to hotel
- Housekeeping
- Reports (hotel occupancy/revenue + restaurant daily/monthly + admin summary)
- Business date + **Day Close**

## Quick start (local)

1. Create a `.env` file:

   - Copy `.env.example` → `.env`
   - Set `DATABASE_URL`

2. Install and run:

```bash
npm install
npm run db:migrate
npm run dev
```

Open the app on `http://localhost:3000`.

## Production notes

- Build artifacts (like `.next/`) should not be committed. If you previously committed them, remove from git index with:

```bash
git rm -r --cached .next
```

## Roadmap to “full hotel PMS”

- Secure auth (replace header-based session with proper token/cookie session)
- Folio postings and audit trail hardening
- Night audit / day close locking + reopen flow
- Cashbook, shift close, and daily reconciliation reports
- Additional operational reports (ADR/RevPAR, tax, departmental revenue)

