# Yup! 369 — Development Status

Last Updated: 2026-11-20

## Implemented in MVP

### Platform & PWA Core
- [x] Mobile-first responsive Black / White / Yellow (`#FFC700`) / Orange (`#FF6B00`) design system
- [x] Vite PWA integration (`vite-plugin-pwa`) with `standalone` manifest, Workbox precaching, 192px/512px/maskable/Apple Touch PNG icons, in-app `PWAInstallButton`, and `OfflineIndicator`
- [x] Express + TypeScript backend (`server.ts`) with `scrypt` password hashing, HMAC-SHA256 Bearer sessions, atomic file persistence (`data/store.json`), and full audit logging
- [x] Supabase-ready SQL schema (`supabase/schema.sql`) and `@supabase/supabase-js` client adapter (`src/lib/supabase.ts`)

### Customer Role
- [x] Public Customer registration and sign-in
- [x] Home screen with active service filters (`Food Delivery`, `Self-Pickup`) and locked disabled services (`Grocery`, `Parcel`, `Bike Taxi`)
- [x] Restaurant listing and detailed restaurant menu view with Veg/Non-Veg markers
- [x] Live dish & restaurant search with Veg-only toggle
- [x] Restaurant-scoped Cart with quantity steppers and live pricing breakdown
- [x] Honest Checkout (`Cash on Delivery` or `Pay at Restaurant Counter`, no fake online payment success)
- [x] Order History with step-by-step milestone tracking (no fake GPS)
- [x] Customer Profile management

### Rider Role
- [x] One unified public Rider registration form with 5 validated sections: (1) Personal info + City/Area, (2) Vehicle info (type, registration plate, dummy driving licence, dummy gov ID), (3) Service selection (`Food Delivery` active; `Grocery`, `Parcel`, `Bike Taxi` disabled), (4) Document submission status (`Pending | Approved | Rejected`, never auto-approved), and (5) Dummy bank details structure (`TEST-ACCT-*`, `MOCK0003690`, `DUMMY-PAY-*`)
- [x] Client & server validation blocking 9–18 digit numeric Aadhaar or bank account numbers
- [x] Owner-gated Online/Offline availability toggle (requires both Documents Approved AND Food Delivery Service Approved)
- [x] Assigned jobs view with Accept / Reject workflow
- [x] Pickup confirmation and Delivery completion (COD confirmation)
- [x] Earnings ledger (`UNPAID_PENDING_MANUAL_REVIEW` vs `SETTLED_MANUALLY`) and Owner manual payout history

### Owner / Super Admin Role
- [x] Private Owner login (`OWNER_ADMIN_EMAIL` / `OWNER_ADMIN_PASSCODE` env vars or one-time first-run claim); public Owner signup blocked
- [x] Overview dashboard with KPI metrics and service governance matrix
- [x] Order management and Online/Approved Rider assignment
- [x] Restaurant & Menu management (create restaurants, toggle open/delivery/pickup, add menu items, toggle availability)
- [x] **Owner Rider Approval Dashboard**: search riders by name/email, filter by Pending/Approved/Rejected, inspect profile/vehicle/dummy bank/document references, separately approve or reject Rider documents (with required rejection reason), separately approve or reject `Food Delivery` service (with required rejection reason), and review per-rider & global persisted approval history (`rider_approval_history`)
- [x] Customer account management (Active / Suspended)
- [x] Live Pricing Settings (Delivery Fee, Free Delivery Threshold, Platform Fee, Self-Pickup Fee, Rider Commission %)
- [x] Manual Payout Records (strictly manual, never auto-approved)
- [x] Searchable Audit Logs

---

## Investigation & Findings (Rider Registration & Owner Dashboard)
1. **Why `Sneha Nair (sneha@rider.demo)` appeared instead of `Priya Sharma`**:
   - **Hardcoded Demo Riders in Operational Store**: `server.ts` (`createSeedStore()`) previously seeded two hardcoded demo riders (`Vikram Rao` / `vikram@rider.demo` and `Sneha Nair` / `sneha@rider.demo`) directly inside operational `store.users`, alongside seeded `riderApprovalHistory` (`rah-seed-*`), a demo delivery order (`ord-1001`), and a demo earning (`earn-1001`).
   - **Oldest-First Array Order + Default Selection**: `POST /api/auth/register` appended newly registered riders to the end of `store.users`, while `GET /api/owner/overview` and `GET /api/owner/riders` returned them in oldest-first order. `OwnerPortal.tsx` auto-selected the first pending rider (`res.riders.find(...)`), which was always the seeded `Sneha Nair (sneha@rider.demo)` record.
   - **Registration Input Placeholder vs. Persisted Store**: In `AuthPortal.tsx`, `"Priya Sharma"` is also the placeholder on the Full Name input field. Inspection of `/data/store.json` confirmed no `Priya Sharma` user record existed in the active store (indicating registration either did not complete submission or occurred on a separate/reset store instance).
2. **Actual Data Storage & Supabase Verification**:
   - **Verified Persistence Backend**: Registration, approvals, orders, and approval history are persisted by Express (`server.ts`) to `/data/store.json` via atomic file writes (`saveStore()`).
   - **Supabase Status**: **Not connected** in this runtime (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are not configured in the environment; `src/lib/supabase.ts` returns `null`). `supabase/schema.sql` serves as the migration schema only.
3. **Fixes Applied**:
   - Removed all hardcoded demo rider accounts (`Vikram Rao`, `Sneha Nair`), their seeded approval history (`rah-seed-*`), demo order (`ord-1001`), and demo earning (`earn-1001`) from `createSeedStore()`, `normalizeStore()`, and `/data/store.json`.
   - Removed hardcoded demo rider quick-login buttons (`vikram@rider.demo`, `sneha@rider.demo`) from `AuthPortal.tsx`.
   - Sorted Owner Dashboard rider listings newest-first (`createdAt` descending) in `GET /api/owner/overview` and `GET /api/owner/riders` so newly registered riders appear immediately at the top.
   - Preserved separate Document verification and Food Delivery service approvals, atomic persistence in `/data/store.json`, and the strict requirement that both approvals must be `APPROVED` before a rider can go online.

---

## Intentionally Disabled Until Approved & Implemented
- [ ] **Grocery Delivery** — Disabled in UI and rejected server-side
- [ ] **Parcel Delivery** — Disabled in UI and rejected server-side
- [ ] **Bike Taxi** — Disabled in UI and rejected server-side
- [ ] **Online Payment Gateway (UPI/Card)** — Not integrated; MVP uses Cash on Delivery & Pay at Counter
- [ ] **Live GPS Map Tracking** — Not integrated; MVP uses honest milestone timestamps
- [ ] **Production KYC & Bank Transfers** — Intentionally omitted; MVP uses dummy document references and manual payout logs
- [ ] **Supabase Live Database** — **Not connected** in current environment (missing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / server `SUPABASE_SERVICE_ROLE_KEY`); runtime persists to `/data/store.json`. Safe migration blueprint in `DATABASE_MIGRATION_PLAN.md` has completed its **final technical, security & feasibility review**: verified `auth.admin.createUser()` official docs vs. `@supabase/auth-js` types (removing any reliance on custom `id` in `createUser`), decoupled Auth-generated UUIDs (`profiles.auth_user_id`) from canonical `public.profiles.id` and historical FKs, updated all RLS & private Storage policies to resolve `auth.uid()` via `public.current_profile_id()` / `public.current_user_role()` (using `profiles.auth_user_id = auth.uid()`), verified crash recovery + `signInWithPassword` verification before retiring legacy `scrypt` hashes, documented safe Owner migration, and verified official Free/Pro pricing. Migration has **not** been executed yet.

## Remaining Blockers Before Production Supabase Cutover
- **Supabase Environment & Provisioning**: No live Supabase project or secrets configured (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- **Migration Tooling & Runtime Driver Not Built Yet**: `supabase/schema.sql` still reflects the initial 11-table draft (lacks `private_auth`, `profiles.auth_user_id`, `current_profile_id()`, updated RLS/column triggers, `rider_service_approvals`, `payments`, `refunds`, and `service_zones`); `StoreRepository` (`STORAGE_DRIVER=json|supabase`), `scripts/migrate-store-to-supabase.ts`, and `scripts/export-supabase-to-store.ts` are not implemented yet.
- **Auth & Owner Hardening Still Pending in Runtime Code**: Persistent `SESSION_SECRET` enforcement in production, login rate-limiting, production disabling/gating of `/api/auth/owner-bootstrap`, and post-cutover Owner MFA enrollment remain to be implemented before production launch.

## Next Steps for Production Readiness
1. Review `DATABASE_MIGRATION_PLAN.md`, provision Supabase project, apply finalized PostgreSQL schema (`private_auth` + 15 `public` tables, `profiles.auth_user_id` helpers/triggers, indexes, RLS, and private Storage bucket), and configure server-side `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (plus optional client `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
2. Set persistent `SESSION_SECRET`, `OWNER_ADMIN_EMAIL`, and `OWNER_ADMIN_PASSCODE` in production environment secrets (disable open `/api/auth/owner-bootstrap` in production).
3. Integrate verified payment gateway, KYC provider, and real-time Maps/GPS SDK before enabling additional services.
