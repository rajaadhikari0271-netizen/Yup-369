# Yup! 369 — Safe Supabase PostgreSQL Migration Plan (Security & Feasibility Reviewed)

**Status:** Planning, Inspection & Security Review Only (Migration **NOT** Executed)  
**Current Runtime Persistence:** Express (`server.ts`) in-memory `AppStore` backed by `/data/store.json`  
**Supabase Connection Status:** **NOT CONNECTED** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are unset; `src/lib/supabase.ts` returns `null`).

---

## 0. Security & Feasibility Review Summary (Key Corrections Applied)

A security and feasibility review of the initial migration draft identified **7 critical issues**, all corrected in this document:
1. **`scrypt` Password Hash Migration vs. Supabase Auth (`createUser` UUID Separation)**: Supabase Auth (`auth.users`) uses bcrypt/Argon2 internally and cannot verify raw `crypto.scryptSync` + 16-byte salt hashes directly. Furthermore, the official Supabase JS documentation for `auth.admin.createUser()` does not document a custom `id` parameter (`AdminUserAttributes` documents `email`, `phone`, `password`, `email_confirm`, `phone_confirm`, `user_metadata`, `app_metadata`, `ban_duration`; even though `@supabase/auth-js` types include an undocumented optional `id?: string`, portable migration must **not** depend on passing `id`). **Fix**: Keep legacy `scrypt` hashes inside non-exposed `private_auth.legacy_credentials` linked to `public.profiles(id)`, let Supabase Auth generate its own `auth.users.id` Just-In-Time (`createUser` without `id`) **only after** `scrypt` verification passes, link the generated Auth UUID into `public.profiles.auth_user_id`, verify login via `signInWithPassword`, and map all RLS policies through `profiles.auth_user_id = auth.uid()` while preserving `public.profiles.id` across all historical foreign keys.
2. **Owner Virtual ID (`owner-env`) vs. UUID Foreign Keys**: Express currently uses `'owner-env'` when `OWNER_ADMIN_*` env vars are set and allows one-time `/api/auth/owner-bootstrap`. Inserting `'owner-env'` into `manual_payouts.recorded_by uuid references public.profiles(id)` would fail. **Fix**: Provision a deterministic `profiles` UUID row (`role = 'OWNER'`, `legacy_id = 'owner-env'` or `'owner-1'`), migrate Owner credentials via Auth-generated UUID linked to `profiles.auth_user_id` (`app_metadata.role = 'OWNER'`), guard bootstrap behind server secrets, add login rate limiting, and fail-closed on missing `SESSION_SECRET` in production.
3. **`service_role` Bypasses RLS + Column-Level Escalation Risk**: Because Express uses `SUPABASE_SERVICE_ROLE_KEY`, PostgreSQL RLS is **bypassed** on all Express queries — Express middleware (`requireAuth`, ownership checks) remains the primary security boundary. Meanwhile, standard row-level `UPDATE` RLS on `profiles` does **not** prevent a user from updating privileged columns (`id`, `auth_user_id`, `role`, `document_status`, `approval_status`, `is_online`) via PostgREST unless restricted by column-level `GRANT UPDATE (...)` and a `BEFORE UPDATE` trigger.
4. **Private Storage for Rider Documents**: Production rider document uploads require a private Supabase Storage bucket (`rider-kyc-docs`, `public = false`), path-scoped `storage.objects` RLS keyed to `public.current_profile_id()::text`, file-type/size limits, and short-lived server-generated Signed URLs (`60s`) for Owner review.
5. **Snapshot Columns for Immutable Order & Financial History**: `orders`, `rider_earnings`, `manual_payouts`, and `rider_approval_history` in the API rely on point-in-time snapshot fields (`customer_name`, `restaurant_name`, `assigned_rider_plate`, `order_number`, etc.) that must be preserved alongside normalized foreign keys.
6. **Post-Cutover Rollback Data Loss & Order Number Collisions**: Reverting `STORAGE_DRIVER=json` after live Supabase writes would drop new users/orders/approvals and risk `YUP-*` number collisions unless an automated reverse-export script (`export-supabase-to-store.ts`) dumps Supabase state + `MAX(order_number)` back to JSON during brief maintenance mode and legacy credential hashes are retained during a 7–14 day burn-in period.
7. **Schema Coverage & Accurate Pricing**: Schema count corrected to **15 `public` tables + 1 `private_auth` table** (covering all 32 Express API routes); Supabase Free (`5 GB` uncached + `5 GB` cached egress, `1 GB` storage, `50,000` MAUs, `~500 MB` RAM) and Pro (`$25/mo` per org, `250 GB` uncached + `250 GB` cached egress, `100 GB` storage, `100,000` MAUs, `$10` compute credit for 1 Micro `1 GB` RAM instance, 7-day daily backups, `$100/mo+` PITR add-on) verified against official limits.

---

## 1. Current Architecture & Data Storage Inventory

### 1.1 Runtime Architecture
- **Frontend**: React 19 + TypeScript + Vite 8 + Tailwind CSS v4 (`src/App.tsx`, `AuthPortal.tsx`, `CustomerPortal.tsx`, `RiderPortal.tsx`, `OwnerPortal.tsx`).
- **API Client**: `src/services/api.ts` communicates exclusively with Express `/api/*` endpoints using an in-memory HMAC-SHA256 `Authorization: Bearer <token>` header (never persisted to `localStorage`/`sessionStorage`).
- **Backend Server**: `server.ts` serves both the Express REST API and Vite/static SPA on port `3000`.
- **Current Persistence**: `server.ts` loads `/data/store.json` at startup (`loadStore()`), mutates the in-memory `store` object, and writes atomically via a `.tmp` file + `fs.renameSync` (`saveStore()`).
- **Supabase Scaffold**: `@supabase/supabase-js` is installed in `package.json`, `src/lib/supabase.ts` contains a lazy client helper (currently unused by portals), and `supabase/schema.sql` contains an initial 11-table draft schema missing `rider_service_approvals`, `service_zones`, `payments`/`refunds`, `legacy_id` columns, `order_number_seq`, `manual_payout_id` FK, indexes, column-level update guards, and operational RLS policies.

### 1.2 Data Models Currently Stored in `/data/store.json`

| Domain Area | Current Location in `/data/store.json` | Current Fields & Gaps |
|---|---|---|
| **1. Users & Authentication** | `users[]` (`StoredUser`) & `ownerCredential` (`OwnerCredential \| null`) | `users[]`: `id`, `role` (`CUSTOMER \| RIDER`), `name`, `email`, `phone`, `cityArea`, `status` (`ACTIVE \| SUSPENDED`), `savedAddress`, `passwordHash` (`scrypt`), `passwordSalt`, `createdAt`.<br>`ownerCredential`: `id` (`owner-1`), `name`, `email`, `passwordHash`, `passwordSalt`, `claimedAt` (used only when `OWNER_ADMIN_PASSCODE` env var is unset). |
| **2. Riders & Vehicle Details** | Embedded in `users[]` (`role === 'RIDER'`) & `documents` | `cityArea`, `isOnline`, `approvalStatus`, `documents.dummyVehicleType` (`Scooter \| Motorcycle \| E-Bike \| Bicycle`), `documents.dummyVehiclePlate`. Live GPS coordinates do **not** exist (intentionally omitted). |
| **3. Document Verification** | Embedded in `users[]` (`role === 'RIDER'`) | `documentStatus` (`PENDING \| APPROVED \| REJECTED`), `documentNotes`, `approvalNotes`, `documents.dummyGovIdRef`, `documents.dummyLicenseRef`, `documents.dummyPayoutRef`, `documents.submittedAt`, `documents.dummyBankDetails` (`accountHolderName`, `dummyAccountNumber`, `dummyIfscCode`, `dummyPayoutRef`). Numeric 9–18 digit Aadhaar/bank numbers are rejected. |
| **4. Service Approvals** | Embedded JSON object `users[].serviceApprovals` | Keyed by `FOOD_DELIVERY`, `GROCERY`, `PARCEL`, `BIKE_TAXI`. Each holds `{ requested, status ('PENDING' \| 'APPROVED' \| 'REJECTED' \| 'DISABLED'), notes, updatedAt }`. Only `FOOD_DELIVERY` is active; the other 3 remain `DISABLED`. |
| **5. Restaurants & Menus** | `restaurants[]` with nested `menu[]` (`MenuItem[]`) | `restaurants[]`: `id`, `name`, `cuisine`, `address`, `prepTimeMins`, `rating`, `imageUrl`, `isOpen`, `supportsDelivery`, `supportsSelfPickup`.<br>Nested `menu[]`: `id`, `restaurantId`, `name`, `description`, `category`, `price`, `isVeg`, `isAvailable`. |
| **6. Orders & Order Assignments** | `orders[]` (`Order[]`) + `orderCounter` (number, e.g. `1002`) | `id`, `orderNumber` (`YUP-1002`), `customerId`, `customerName`, `customerPhone`, `restaurantId`, `restaurantName`, `restaurantAddress`, `serviceType` (`FOOD_DELIVERY \| SELF_PICKUP`), nested `items[]`, `deliveryAddress`, `pickupInstructions`, `status` (`PLACED \| CONFIRMED \| PREPARING \| READY_FOR_PICKUP \| PICKED_UP \| COMPLETED \| CANCELLED`), `assignedRiderId`, `assignedRiderName`, `assignedRiderPhone`, `assignedRiderPlate`, `riderJobStatus` (`UNASSIGNED \| ASSIGNED \| ACCEPTED \| REJECTED \| COMPLETED`), `milestones[]`, `createdAt`, `updatedAt`. |
| **7. Payments & Refunds** | Embedded fields on `orders[]` | `subtotal`, `deliveryFee`, `platformFee`, `totalAmount`, `riderFee`, `paymentMethod` (`CASH_ON_DELIVERY \| PAY_AT_COUNTER`), `paymentStatus` (`PENDING_COLLECTION \| COLLECTED_ON_DELIVERY \| PAID_AT_COUNTER`). **Gap**: No separate `payments` or `refunds` table exists yet (no online gateway or automated refund workflow in MVP). |
| **8. Rider Earnings & Payouts** | `riderEarnings[]` & `manualPayouts[]` | `riderEarnings[]`: `id`, `orderId`, `orderNumber`, `riderId`, `restaurantName`, `amount`, `payoutStatus` (`UNPAID_PENDING_MANUAL_REVIEW \| SETTLED_MANUALLY`), `manualPayoutId`, `completedAt`.<br>`manualPayouts[]`: `id`, `riderId`, `riderName`, `amount`, `referenceNumber`, `methodNote`, `recordedBy`, `recordedAt`. |
| **9. Cities, Areas & Zones** | Free-text strings (`users[].cityArea`, `restaurants[].address`) | **Gap**: No normalized `cities` or `service_zones` table exists in `/data/store.json` yet; zone matching is informational text only. |
| **10. Pricing Settings** | `pricing` singleton object | `baseDeliveryFee`, `freeDeliveryThreshold`, `platformFee`, `selfPickupFee`, `riderCommissionPercent`, `updatedAt`. |
| **11. Approval History & Audit Logs** | `riderApprovalHistory[]` & `auditLogs[]` (capped at 500 entries each in JSON) | `riderApprovalHistory[]`: `id`, `riderId`, `riderName`, `riderEmail`, `target` (`DOCUMENTS \| SERVICE_FOOD_DELIVERY \| REGISTRATION`), `serviceKey`, `previousStatus`, `newStatus`, `reason`, `actorId`, `actorRole`, `actorEmail`, `timestamp`.<br>`auditLogs[]`: `id`, `timestamp`, `actorId`, `actorRole`, `actorEmail`, `action`, `target`, `details`. |

---

## 2. Complete Express API Route Inventory & Data Mapping

All **32 Express API endpoints** in `server.ts` (plus the production SPA fallback `GET *`) are mapped below:

| Method & Route | Auth / Role | Records Read | Records Modified / Created |
|---|---|---|---|
| `GET /api/public/catalog` | Public | `SERVICES` constant, `restaurants[]` (+ `menu[]`), `pricing` | None |
| `POST /api/auth/register` | Public (`CUSTOMER \| RIDER` only; `OWNER` returns `403`) | `users[]` (duplicate email check) | Inserts `users[]`, `riderApprovalHistory[]` (if `RIDER`), `auditLogs[]` |
| `POST /api/auth/login` | Public (`CUSTOMER \| RIDER`) | `users[]` (`email`, `passwordHash`, `passwordSalt`, `status`) | None (issues signed Bearer token) |
| `GET /api/auth/me` | Any authenticated token | `ownerCredential` / env Owner config OR `users[]` | None |
| `GET /api/auth/owner-status` | Public (boolean + mode only) | Env `OWNER_ADMIN_PASSCODE`, `ownerCredential` | None |
| `POST /api/auth/owner-bootstrap` | Public only while unconfigured (`403` once claimed/env-set) | `ownerCredential`, env Owner config | Sets `ownerCredential`, inserts `auditLogs[]` |
| `POST /api/auth/owner-login` | Private Owner | Env Owner config OR `ownerCredential` | Inserts `auditLogs[]` (`OWNER_LOGIN`) |
| `PATCH /api/customer/profile` | `CUSTOMER` | `users[]` | Updates `name`, `phone`, `savedAddress` in `users[]` |
| `GET /api/customer/orders` | `CUSTOMER` | `orders[]` filtered by `customerId` | None |
| `POST /api/orders` | `CUSTOMER` | `users[]`, `restaurants[]` (+ `menu[]`), `pricing`, `orderCounter` | Increments `orderCounter`, inserts `orders[]`, updates `users[].savedAddress`, inserts `auditLogs[]` |
| `GET /api/rider/profile` | `RIDER` | `users[]` | None |
| `POST /api/rider/documents` | `RIDER` | `users[]` | Updates `users[].cityArea`, `documents`, resets `documentStatus='PENDING'`, updates `documentNotes`/`approvalNotes`, forces `isOnline=false`, inserts `riderApprovalHistory[]`, `auditLogs[]` |
| `PATCH /api/rider/availability` | `RIDER` | `users[]` (verifies BOTH `documentStatus === 'APPROVED'` and `FOOD_DELIVERY === 'APPROVED'`) | Updates `users[].isOnline`, inserts `auditLogs[]` |
| `GET /api/rider/jobs` | `RIDER` | `orders[]` filtered by `assignedRiderId` | None |
| `POST /api/rider/jobs/:orderId/respond` | `RIDER` | `users[]`, `orders[]` | Updates `orders[].riderJobStatus` (`ACCEPTED` or `REJECTED` + clears assignment), appends `orders[].milestones`, inserts `auditLogs[]` |
| `POST /api/rider/jobs/:orderId/pickup` | `RIDER` | `users[]`, `orders[]` | Updates `orders[].status='PICKED_UP'`, appends `orders[].milestones`, inserts `auditLogs[]` |
| `POST /api/rider/jobs/:orderId/complete` | `RIDER` | `users[]`, `orders[]`, `riderEarnings[]` | Updates `orders[].status='COMPLETED'`, `riderJobStatus='COMPLETED'`, `paymentStatus='COLLECTED_ON_DELIVERY'`, appends `milestones`, inserts `riderEarnings[]` (`UNPAID_PENDING_MANUAL_REVIEW`), `auditLogs[]` |
| `GET /api/rider/earnings` | `RIDER` | `riderEarnings[]`, `manualPayouts[]` | None |
| `GET /api/owner/overview` | `OWNER` | `users[]`, `orders[]`, `restaurants[]`, `pricing`, `riderEarnings[]`, `manualPayouts[]`, `riderApprovalHistory[]`, `auditLogs[]` | None |
| `GET /api/owner/riders` | `OWNER` | `users[]` (`role === 'RIDER'`), `riderEarnings[]`, `manualPayouts[]` | None (filters `q`, `status`, sorts newest-first) |
| `GET /api/owner/riders/:id/history` | `OWNER` | `users[]`, `riderApprovalHistory[]` | None |
| `PATCH /api/owner/customers/:id/status` | `OWNER` | `users[]` | Updates `users[].status` (`ACTIVE \| SUSPENDED`), inserts `auditLogs[]` |
| `PATCH /api/owner/riders/:id/approval` | `OWNER` | `users[]` | Updates `documentStatus`, `serviceApprovals.FOOD_DELIVERY`, `documentNotes`, `approvalNotes`, `approvalStatus`, `isOnline`, inserts `riderApprovalHistory[]` (2 rows) & `auditLogs[]` |
| `PATCH /api/owner/riders/:id/documents-status` | `OWNER` | `users[]` | Updates `documentStatus`, `documentNotes`, `approvalNotes`, `approvalStatus`, `isOnline`, inserts `riderApprovalHistory[]` (`DOCUMENTS`), `auditLogs[]` |
| `PATCH /api/owner/riders/:id/service-approval` | `OWNER` | `users[]` | Updates `serviceApprovals.FOOD_DELIVERY`, `approvalNotes`, `approvalStatus`, `isOnline`, inserts `riderApprovalHistory[]` (`SERVICE_FOOD_DELIVERY`), `auditLogs[]` |
| `POST /api/owner/restaurants` | `OWNER` | `restaurants[]` | Inserts `restaurants[]`, `auditLogs[]` |
| `PATCH /api/owner/restaurants/:id` | `OWNER` | `restaurants[]` | Updates `restaurants[]` flags/metadata, inserts `auditLogs[]` |
| `POST /api/owner/restaurants/:id/menu` | `OWNER` | `restaurants[]` | Pushes `MenuItem` into `restaurants[].menu[]`, inserts `auditLogs[]` |
| `PATCH /api/owner/menu/:itemId` | `OWNER` | `restaurants[]` | Updates `MenuItem` (`isAvailable`, `price`, `name`), inserts `auditLogs[]` |
| `PATCH /api/owner/orders/:orderId/status` | `OWNER` | `orders[]` | Updates `orders[].status`, `paymentStatus` (`PAID_AT_COUNTER` on completed pickup), appends `milestones[]`, inserts `auditLogs[]` |
| `POST /api/owner/orders/:orderId/assign-rider` | `OWNER` | `orders[]`, `users[]` (checks rider online + dual approval) | Updates `orders[].assignedRider*`, `riderJobStatus='ASSIGNED'`, `status='CONFIRMED'`, appends `milestones[]`, inserts `auditLogs[]` |
| `PATCH /api/owner/pricing` | `OWNER` | `pricing` | Updates `pricing`, inserts `auditLogs[]` |
| `POST /api/owner/payouts` | `OWNER` | `users[]`, `riderEarnings[]`, `manualPayouts[]` | Inserts `manualPayouts[]`, updates `riderEarnings[].payoutStatus='SETTLED_MANUALLY'` & `manualPayoutId`, inserts `auditLogs[]` |

> **Workflow Coverage Check**: All 32 routes map cleanly to the proposed 15 `public` + 1 `private_auth` tables below. Platform service toggles (`SERVICES`: `FOOD_DELIVERY`, `SELF_PICKUP` enabled; `GROCERY`, `PARCEL`, `BIKE_TAXI` disabled) remain enforced as server-side configuration constants in `server.ts` so disabled services cannot be accidentally enabled through database edits.

---

## 3. Authentication & Password Migration Strategy (`scrypt` → Supabase Auth)

Because Supabase Auth (`auth.users`) uses internal bcrypt/Argon2 hashing and **cannot** natively verify legacy Node.js `crypto.scryptSync` hashes + 16-byte salts, migration follows a **Just-In-Time (JIT) verified creation** workflow that never stores password hashes in `public.*`, never pre-creates `auth.users` rows with dummy passwords, **lets Supabase Auth generate its own UUID**, preserves all `public.profiles.id` foreign keys, and requires zero forced password resets for active users.

### 3.0 Verified `auth.admin.createUser()` API & TypeScript Surface
- **Official Supabase JS Documentation (`createUser`)**: Documents `AdminUserAttributes` fields `email`, `phone`, `password`, `email_confirm`, `phone_confirm`, `user_metadata`, `app_metadata`, and `ban_duration` — it **does not** document a custom `id` parameter.
- **Installed SDK Type Inspection (`@supabase/auth-js` `types.d.ts`)**: `AdminUserAttributes` extends `Omit<UserAttributes, 'data'>` with `user_metadata?`, `app_metadata?`, `email_confirm?`, `phone_confirm?`, `ban_duration?`, `role?`, `password_hash?`, and an undocumented `id?: string`.
- **Architectural Rule**: Because custom `id` is undocumented in official Supabase docs and not guaranteed across GoTrue versions/configurations, this migration **must never pass `id`** to `supabaseAdmin.auth.admin.createUser()`. Supabase Auth always generates `data.user.id`, and the application links that UUID via `public.profiles.auth_user_id`.

### 3.1 Preserving Existing `profiles.id`, Historical Foreign Keys & Role Mapping
- **Decoupled Identity Model (`profiles.id` vs. `profiles.auth_user_id`)**:
  - `public.profiles.id` (`uuid primary key default gen_random_uuid()`) is the **permanent canonical application ID** assigned during backfill (`legacy_id` stores `"cust-1"`, `"rider-..."`, `"owner-1"`, or `"owner-env"`). **Every foreign key** (`rider_documents.rider_id`, `rider_service_approvals.rider_id`, `orders.customer_id`, `orders.assigned_rider_id`, `rider_earnings.rider_id`, `manual_payouts.rider_id`, `manual_payouts.recorded_by`, `refunds.processed_by`, `rider_approval_history.rider_id`) references `public.profiles(id)` — never `auth.users(id)` directly.
  - `public.profiles.auth_user_id` (`uuid unique references auth.users(id) on delete set null`) starts **`NULL`** for backfilled legacy accounts that do not yet exist in `auth.users`.
  - When Supabase Auth creates the user and returns its own generated UUID `data.user.id` (`auth.users.id !== public.profiles.id`), Express writes `public.profiles.auth_user_id = data.user.id`. All existing orders, approvals, earnings, and payouts remain linked to `public.profiles.id` with **zero cascading primary-key updates**.
- **How `auth.uid()` Maps Through `profiles.auth_user_id` for All Three Roles**:
  - **Customer**: Historical and new orders store `orders.customer_id = profiles.id`. When the customer authenticates via Express or PostgREST, `auth.uid()` equals `profiles.auth_user_id`; RLS resolves `public.current_profile_id()` (`SELECT id FROM public.profiles WHERE auth_user_id = auth.uid()`) so the customer reads only rows where `customer_id = public.current_profile_id()`. Express similarly resolves `profile` by `auth_user_id` (post-migration) and sets `req.auth.userId = profile.id`.
  - **Rider**: `rider_documents.rider_id`, `rider_service_approvals.rider_id`, `orders.assigned_rider_id`, `rider_earnings.rider_id`, `manual_payouts.rider_id`, and `rider_approval_history.rider_id` all reference `profiles.id`. Once `profiles.auth_user_id` is populated on verified login, `public.current_profile_id()` maps the Rider's Auth JWT (`auth.uid()`) back to `profiles.id`, preserving access to KYC refs, approvals, assigned jobs, earnings, payouts, and private Storage folder `rider-kyc-docs/{profiles.id}/*`.
  - **Owner / Super Admin**: Both `owner-1` and `owner-env` receive a deterministic `profiles.id` row (`role = 'OWNER'`) referenced by `manual_payouts.recorded_by` and `refunds.processed_by`. Once provisioned/verified in Supabase Auth, `profiles.auth_user_id` stores the Auth-generated UUID (alongside server-only `app_metadata.role = 'OWNER'`). `public.current_user_role()` looks up `profiles.role` via `WHERE auth_user_id = auth.uid() AND status = 'ACTIVE'`, authorizing Owner RLS access without assuming `auth.uid() = profiles.id`.

### 3.2 Isolated Credential Schema (`private_auth.legacy_credentials`)
- Create a non-exposed PostgreSQL schema `private_auth` (omitted from Supabase PostgREST `Exposed schemas`; all privileges revoked from `anon` and `authenticated`).
- Table `private_auth.legacy_credentials`:
  - `profile_id uuid primary key references public.profiles(id) on delete cascade`
  - `email text not null` *(normalized lowercase)*
  - `password_hash text` *(nullable only after post-burn-in retirement)*
  - `password_salt text` *(nullable only after post-burn-in retirement)*
  - `migration_state text not null default 'PENDING' check (migration_state in ('PENDING', 'IN_PROGRESS', 'VERIFIED', 'RETIRED'))`
  - `migrated_auth_user_id uuid` *(stores the Supabase Auth-generated `auth.users.id`)*
  - `verified_at timestamptz`, `last_error text`, `updated_at timestamptz not null default now()`

### 3.3 Creating a Legacy User in Supabase Auth After `scrypt` Verification
During initial backfill (Stage A), Express populates `public.profiles` (`auth_user_id = NULL`) and `private_auth.legacy_credentials` (`migration_state = 'PENDING'`), **without** inserting into `auth.users`. On `POST /api/auth/login` (Stage B):
1. Normalize email (`email.trim().toLowerCase()`) and look up `public.profiles` + `private_auth.legacy_credentials` via `SUPABASE_SERVICE_ROLE_KEY`. Reject `SUSPENDED` accounts (`403`) and reject `role = 'OWNER'` on public login (`403`; Owners use `/api/auth/owner-login`).
2. **If `profiles.auth_user_id IS NOT NULL` AND `migration_state IN ('VERIFIED', 'RETIRED')`**:
   - Authenticate directly via `supabaseAnon.auth.signInWithPassword({ email, password })` (no legacy `scrypt` check needed), resolve `profile` by `auth_user_id = data.user.id`, and operate internally with `profile.id`.
3. **If `profiles.auth_user_id IS NULL` (or `migration_state IN ('PENDING', 'IN_PROGRESS')`)**:
   - **Step 1 — Verify legacy `scrypt` hash**: Run `crypto.scryptSync(password, salt, 64)` and compare using `crypto.timingSafeEqual` (matching `server.ts`). On mismatch, return `401 Invalid credentials` without touching `auth.users`.
   - **Step 2 — Acquire row lock / transition state**: Inside a server transaction or `UPDATE ... WHERE profile_id = $1 AND migration_state IN ('PENDING', 'IN_PROGRESS') RETURNING *`, set `migration_state = 'IN_PROGRESS'`.
   - **Step 3 — Create `auth.users` record (Supabase Auth generates its own UUID)**: Call using only documented `AdminUserAttributes`:
     ```ts
     const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
       email: profile.email, // already lowercased
       password,             // verified plaintext from this login request
       email_confirm: true,  // prevents blocking login on unverified email
       app_metadata: {
         role: profile.role,
         profile_id: profile.id,
         legacy_id: profile.legacyId,
       },
       user_metadata: { name: profile.name },
     });
     const generatedAuthUserId = created.user.id;
     ```
   - **Step 4 — Live login verification before committing link** (Section 3.5), then persist `public.profiles.auth_user_id = generatedAuthUserId`, `private_auth.legacy_credentials.migrated_auth_user_id = generatedAuthUserId`, and `migration_state = 'VERIFIED'`.
4. **New Registrations (`POST /api/auth/register`)**: Create the `auth.users` account first (`app_metadata.role` strictly `'CUSTOMER' | 'RIDER'`, returning `403` for `'OWNER'`), capture the Auth-generated `created.user.id`, and insert `public.profiles` with a generated `id` and `auth_user_id = created.user.id` (zero `private_auth.legacy_credentials` row needed; `profiles.id` and `auth_user_id` work uniformly across both new and migrated users).

### 3.4 Handling Duplicate Emails & Interrupted Migrations
- **Duplicate Emails (Pre-Flight & Runtime)**:
  - `server.ts` already enforces case-insensitive uniqueness on `store.users`, and `public.profiles` enforces `create unique index idx_profiles_email_lower on public.profiles (lower(email))`.
  - **Pre-migration check**: `scripts/migrate-store-to-supabase.ts --dry-run` scans all `store.users` + `ownerCredential` + `OWNER_ADMIN_EMAIL` with `trim().toLowerCase()` and **aborts migration before any writes** if any collision exists (including a Customer/Rider sharing an email with the Owner). Conflicts must be deduplicated or assigned distinct Owner emails before cutover.
  - **Runtime `auth.users` collision guard**: Because GoTrue enforces unique `email` in `auth.users`, if `auth.admin.createUser()` returns an `already registered / duplicate email` error:
    - Look up the existing `auth.users` record by normalized email via a **non-exposed `service_role`-only Postgres RPC** (`private_auth.find_auth_user_by_email(p_email text)` querying `auth.users WHERE lower(email) = lower(p_email)` — faster and safer than paging `listUsers()`).
    - **Strict Ownership Check**: Because `auth.users.id` differs from `profile.id`, never match on email alone if unverified. Allow recovery **only if** `existingAuthUser.raw_app_meta_data?.profile_id === profile.id` (set when our own JIT flow created the row prior to a crash) **or** `profiles.auth_user_id === existingAuthUser.id`.
    - If `existingAuthUser` has no matching `profile_id` (belongs to another identity or external pre-existing Auth account), **fail closed** (`409 Conflict` + high-severity `audit_logs` alert) for manual admin review rather than merging or overwriting accounts.
- **Interrupted Migrations (Crash Between `createUser`, `profiles`, and `legacy_credentials`)**:
  - **Partial backfill interruption**: `migrate-store-to-supabase.ts` runs inside per-user DB transactions (`profiles` + `private_auth.legacy_credentials` + `rider_documents` + `rider_service_approvals`) using deterministic `ON CONFLICT (legacy_id) DO UPDATE`, so re-running after a crash leaves zero duplicates and finishes incomplete rows.
  - **Partial JIT login crash** (e.g., `auth.admin.createUser()` succeeded and generated `auth_user_id = U_auth`, then the server crashed before updating `profiles.auth_user_id = U_auth` and `migration_state = 'VERIFIED'`):
    - On the user's next login attempt, `profiles.auth_user_id` is still `NULL` and `migration_state` is `'IN_PROGRESS'` (or `'PENDING'`).
    - Express re-verifies the user's `scrypt` hash (proving credential ownership), calls `createUser(...)`, catches `already registered`, looks up `existingAuthUser` via `private_auth.find_auth_user_by_email(profile.email)`, confirms `existingAuthUser.raw_app_meta_data.profile_id === profile.id`, updates password/metadata via `supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, { password, email_confirm: true, app_metadata: { role: profile.role, profile_id: profile.id, legacy_id: profile.legacyId } })`, runs live `signInWithPassword` verification (Section 3.5), and commits `profiles.auth_user_id = existingAuthUser.id`, `migrated_auth_user_id = existingAuthUser.id`, and `migration_state = 'VERIFIED'`.
  - **Concurrent double-login race**: Using an explicit PostgreSQL advisory lock (`pg_advisory_xact_lock(hashtext(profile.id::text))`) or atomic `UPDATE ... WHERE migration_state = 'PENDING'` serializes concurrent login requests from the same user so the second request waits and then uses the linked `profiles.auth_user_id` path.

### 3.5 Verifying the New Supabase Auth Login Before Retiring Legacy Hashes
A user's legacy `scrypt` hash is **never** treated as retired simply because `createUser` returned HTTP 200:
1. **Immediate Ephemeral Login Proof**: Immediately after `auth.admin.createUser` (or crash-recovery `updateUserById`), Express creates a short-lived, memory-only Supabase anon client (`persistSession: false`, `autoRefreshToken: false`) and executes:
   ```ts
   const { data: verifyData, error: verifyErr } =
     await ephemeralAnonClient.auth.signInWithPassword({ email: profile.email, password });
   ```
2. **Strict Assertions**: Express commits `profiles.auth_user_id = targetAuthUserId`, `private_auth.legacy_credentials.migrated_auth_user_id = targetAuthUserId`, `migration_state = 'VERIFIED'`, and `verified_at = now()` **only if**:
   - `verifyErr === null` and `verifyData.user?.id === targetAuthUserId`, AND
   - `verifyData.user?.app_metadata?.role === profile.role`, AND
   - `verifyData.user?.app_metadata?.profile_id === profile.id`, AND
   - `verifyData.session?.access_token` is non-empty (then `ephemeralAnonClient.auth.signOut()` clears client memory).
3. **Failure Behavior**: If `signInWithPassword` fails, Express logs `last_error` in `private_auth.legacy_credentials`, leaves `profiles.auth_user_id = NULL`, keeps the legacy `scrypt` hash intact (still authenticating the user cleanly if rollback or retry is needed), and alerts Ops via `audit_logs` (`AUTH_MIGRATION_VERIFY_FAILED`).
4. **Two-Phase Legacy Hash Retirement (Preserving Rollback)**:
   - **Burn-In Phase (Days 0–14 post-cutover)**: Even when `migration_state = 'VERIFIED'`, `password_hash` and `password_salt` are **retained read-only** in `private_auth.legacy_credentials` (never used for login once `VERIFIED`, only preserved so `export-supabase-to-store.ts` can restore working JSON `scrypt` credentials if a full rollback to `STORAGE_DRIVER=json` is triggered).
   - **Final Retirement (Post-Burn-In Only)**: Once the 7–14 day burn-in window passes with zero rollback triggers, an explicit maintenance script sets `password_hash = NULL`, `password_salt = NULL`, `migration_state = 'RETIRED'` **strictly `WHERE migration_state = 'VERIFIED' AND verified_at IS NOT NULL`**. Unmigrated (`PENDING`) inactive users retain their `scrypt` hash until their next login or may recover anytime via `resetPasswordForEmail`.

### 3.6 Migrating Owner Accounts Safely
Express supports two Owner auth modes in `server.ts`, both of which must migrate without breaking `manual_payouts.recorded_by` FKs or opening public Owner creation:
1. **Deterministic Owner UUID Profile (`profiles.id`)**:
   - **Mode A — Claimed `store.ownerCredential` (`id: 'owner-1'`)**: Backfill a `public.profiles` row with deterministic `id` (e.g., UUIDv5 namespace from `'owner-1'`), `auth_user_id = NULL`, `legacy_id = 'owner-1'`, `role = 'OWNER'`, normalized `email`, `status = 'ACTIVE'`, and copy its `passwordHash`/`passwordSalt` into `private_auth.legacy_credentials` (`migration_state = 'PENDING'`).
   - **Mode B — Env-Configured `OWNER_ADMIN_EMAIL` / `OWNER_ADMIN_PASSCODE` (`'owner-env'`)**: Backfill a `public.profiles` row with deterministic `id`, `auth_user_id = NULL`, `legacy_id = 'owner-env'`, `role = 'OWNER'`, `email = normalize(OWNER_ADMIN_EMAIL)`. **Do not store the raw `OWNER_ADMIN_PASSCODE` in the database.**
2. **Safe Cutover for Owner Auth**:
   - **Claimed `ownerCredential`**: Migrates through `/api/auth/owner-login` using the exact same JIT flow: verify `scrypt` -> `createUser({ email, password, email_confirm: true, app_metadata: { role: 'OWNER', profile_id: ownerProfile.id, legacy_id: 'owner-1' } })` (Supabase Auth generates `auth.users.id`) -> verify `signInWithPassword` -> link `profiles.auth_user_id = created.user.id` & `migration_state = 'VERIFIED'`.
   - **Env-Configured Owner**: Either provision the Supabase Auth Owner account via an authenticated server/CLI bootstrap command (`scripts/provision-owner-auth.ts`) from `OWNER_ADMIN_EMAIL`/`OWNER_ADMIN_PASSCODE`, link `profiles.auth_user_id = created.user.id`, and verify `signInWithPassword` immediately during cutover — **or** verify `OWNER_ADMIN_PASSCODE` with `crypto.timingSafeEqual` on first `/api/auth/owner-login` to JIT-create `auth.users`, verify `signInWithPassword`, link `profiles.auth_user_id`, and rotate/remove static env passcodes after Owner login + MFA enrollment are confirmed.
3. **Owner Hardening Controls**:
   - **No public signup / bootstrap**: `POST /api/auth/register` continues returning `403` for `role = 'OWNER'`. Disable `/api/auth/owner-bootstrap` in production once an Owner `profiles` row or `OWNER_ADMIN_*` exists (or require server-only `OWNER_BOOTSTRAP_SECRET`).
   - **Role Trust Boundary**: Always set `app_metadata.role = 'OWNER'` server-side and enforce `profiles.role = 'OWNER'` resolved via `profiles.auth_user_id = auth.uid()`; RLS + column triggers block anyone from changing `profiles.role`, `profiles.id`, or `profiles.auth_user_id`.
   - **Rate Limiting & MFA**: Add strict IP + email rate limiting / exponential backoff on `/api/auth/owner-login` and `/api/auth/login`, fail server startup if `SESSION_SECRET` is unset in production, and enroll TOTP MFA (`auth.mfa`) on the Owner account post-cutover.

---

## 4. Proposed Production Supabase PostgreSQL Schema (15 Public + 1 Private Auth Table)

### 4.1 Tables, Primary Keys, Foreign Keys & Constraints

0. **`private_auth.legacy_credentials`** *(Non-exposed schema; server `service_role` access only)*
   - `profile_id uuid primary key references public.profiles(id) on delete cascade`
   - `email text not null`
   - `password_hash text`, `password_salt text` *(non-null at backfill; nulled only after `VERIFIED` + post-burn-in `RETIRED`)*
   - `migration_state text not null default 'PENDING' check (migration_state in ('PENDING', 'IN_PROGRESS', 'VERIFIED', 'RETIRED'))`
   - `migrated_auth_user_id uuid`, `verified_at timestamptz`, `last_error text`, `updated_at timestamptz not null default now()`
   - *Helper RPC (in `private_auth`, `security definer`, executable only by `service_role`)*: `private_auth.find_auth_user_by_email(p_email text)` returning `(id uuid, email text, raw_app_meta_data jsonb)` for crash recovery without exposing `auth.users`.

1. **`public.service_zones`** *(Normalized cities & areas; additive to existing free-text `city_area`)*
   - `id uuid primary key default gen_random_uuid()`
   - `city text not null`, `area_name text not null`, `is_active boolean not null default true`, `created_at timestamptz not null default now()`
   - `unique (city, area_name)`

2. **`public.profiles`** *(Customers, Riders, Owners — single unified identity table; zero password columns)*
   - `id uuid primary key default gen_random_uuid()` *(canonical immutable UUID referenced by all app FKs — never changed when Supabase Auth generates `auth.users.id`)*
   - `auth_user_id uuid unique references auth.users(id) on delete set null` *(`NULL` until JIT Supabase Auth creation & login verification; populated with Supabase Auth's generated `auth.users.id`)*
   - `legacy_id text unique` *(maps `"cust-1"`, `"rider-..."`, `"owner-1"`, `"owner-env"` during migration)*
   - `role text not null check (role in ('CUSTOMER', 'RIDER', 'OWNER'))`
   - `name text not null`, `email text not null unique`, `phone text not null` *(plus unique index on `lower(email)`)*
   - `city_area text`, `zone_id uuid references public.service_zones(id)`
   - `status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED'))`
   - `saved_address text`
   - `approval_status text check (approval_status in ('PENDING', 'APPROVED', 'REJECTED'))`
   - `document_status text check (document_status in ('PENDING', 'APPROVED', 'REJECTED'))`
   - `document_notes text`, `approval_notes text`
   - `is_online boolean not null default false`
   - `created_at timestamptz not null default now()`

3. **`public.rider_documents`** *(Vehicle, dummy KYC refs / future private storage object paths, dummy bank structure — 1:1 with Rider)*
   - `rider_id uuid primary key references public.profiles(id) on delete cascade`
   - `dummy_gov_id_ref text not null`
   - `dummy_license_ref text not null`
   - `dummy_vehicle_plate text not null`
   - `dummy_vehicle_type text not null check (dummy_vehicle_type in ('Scooter', 'Motorcycle', 'E-Bike', 'Bicycle'))`
   - `dummy_payout_ref text not null`
   - `dummy_bank_details jsonb not null` *(holds `{ accountHolderName, dummyAccountNumber, dummyIfscCode, dummyPayoutRef }`)*
   - `storage_object_paths jsonb not null default '{}'::jsonb` *(optional private Storage paths in `rider-kyc-docs` bucket; never public URLs)*
   - `submitted_at timestamptz not null default now()`

4. **`public.rider_service_approvals`** *(Normalized separate per-service approvals)*
   - `id uuid primary key default gen_random_uuid()`
   - `rider_id uuid not null references public.profiles(id) on delete cascade`
   - `service_key text not null check (service_key in ('FOOD_DELIVERY', 'GROCERY', 'PARCEL', 'BIKE_TAXI'))`
   - `requested boolean not null default false`
   - `status text not null default 'DISABLED' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED'))`
   - `notes text`, `updated_at timestamptz not null default now()`
   - `unique (rider_id, service_key)`

5. **`public.restaurants`**
   - `id uuid primary key default gen_random_uuid()`, `legacy_id text unique`
   - `name text not null`, `cuisine text not null`, `address text not null`, `zone_id uuid references public.service_zones(id)`
   - `prep_time_mins integer not null default 25 check (prep_time_mins between 5 and 120)`
   - `rating numeric(2,1) not null default 4.5`
   - `image_url text not null`, `is_open boolean not null default true`
   - `supports_delivery boolean not null default true`, `supports_self_pickup boolean not null default true`
   - `created_at timestamptz not null default now()`

6. **`public.menu_items`**
   - `id uuid primary key default gen_random_uuid()`, `legacy_id text unique`
   - `restaurant_id uuid not null references public.restaurants(id) on delete cascade`
   - `name text not null`, `description text not null`, `category text not null`
   - `price numeric(10,2) not null check (price >= 0)`
   - `is_veg boolean not null default true`, `is_available boolean not null default true`

7. **`public.pricing_settings`** *(Singleton row `id = 1`)*
   - `id integer primary key default 1 check (id = 1)`
   - `base_delivery_fee numeric(10,2) not null default 29`
   - `free_delivery_threshold numeric(10,2) not null default 399`
   - `platform_fee numeric(10,2) not null default 6`
   - `self_pickup_fee numeric(10,2) not null default 0`
   - `rider_commission_percent integer not null default 80 check (rider_commission_percent between 10 and 100)`
   - `updated_at timestamptz not null default now()`

8. **`public.orders`** + Sequence `public.order_number_seq`
   - `id uuid primary key default gen_random_uuid()`, `legacy_id text unique`
   - `order_number text not null unique` (`'YUP-' || nextval('public.order_number_seq')`)
   - `customer_id uuid not null references public.profiles(id)`
   - `customer_name text not null`, `customer_phone text not null` *(immutable order-time snapshots)*
   - `restaurant_id uuid not null references public.restaurants(id)`
   - `restaurant_name text not null`, `restaurant_address text not null` *(immutable order-time snapshots)*
   - `service_type text not null check (service_type in ('FOOD_DELIVERY', 'SELF_PICKUP'))`
   - `subtotal numeric(10,2) not null`, `delivery_fee numeric(10,2) not null`, `platform_fee numeric(10,2) not null`, `total_amount numeric(10,2) not null`, `rider_fee numeric(10,2) not null default 0`
   - `delivery_address text`, `pickup_instructions text`
   - `payment_method text not null check (payment_method in ('CASH_ON_DELIVERY', 'PAY_AT_COUNTER'))`
   - `payment_status text not null default 'PENDING_COLLECTION' check (payment_status in ('PENDING_COLLECTION', 'COLLECTED_ON_DELIVERY', 'PAID_AT_COUNTER'))`
   - `status text not null default 'PLACED' check (status in ('PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'COMPLETED', 'CANCELLED'))`
   - `assigned_rider_id uuid references public.profiles(id)`
   - `assigned_rider_name text`, `assigned_rider_phone text`, `assigned_rider_plate text` *(assignment snapshots)*
   - `rider_job_status text not null default 'UNASSIGNED' check (rider_job_status in ('UNASSIGNED', 'ASSIGNED', 'ACCEPTED', 'REJECTED', 'COMPLETED'))`
   - `milestones jsonb not null default '[]'::jsonb`
   - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`

9. **`public.order_items`**
   - `id uuid primary key default gen_random_uuid()`
   - `order_id uuid not null references public.orders(id) on delete cascade`
   - `menu_item_id uuid not null references public.menu_items(id)`
   - `name text not null`, `price numeric(10,2) not null`, `quantity integer not null check (quantity > 0)`, `is_veg boolean not null default true`

10. **`public.payments`** *(1:1 order payment record; mirrors COD / Pay-at-Counter today and prepares gateway settlement)*
    - `id uuid primary key default gen_random_uuid()`, `order_id uuid not null unique references public.orders(id) on delete cascade`
    - `method text not null check (method in ('CASH_ON_DELIVERY', 'PAY_AT_COUNTER'))`
    - `status text not null default 'PENDING_COLLECTION' check (status in ('PENDING_COLLECTION', 'COLLECTED_ON_DELIVERY', 'PAID_AT_COUNTER'))`
    - `amount numeric(10,2) not null check (amount >= 0)`, `provider_ref text`, `collected_at timestamptz`, `created_at timestamptz not null default now()`

11. **`public.refunds`** *(Ready for future manual/gateway refunds; unused in COD/Pay-at-Counter MVP)*
    - `id uuid primary key default gen_random_uuid()`
    - `payment_id uuid not null references public.payments(id) on delete cascade`
    - `order_id uuid not null references public.orders(id)`
    - `amount numeric(10,2) not null check (amount > 0)`, `reason text not null`
    - `status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'REJECTED'))`
    - `processed_by uuid references public.profiles(id)`, `created_at timestamptz not null default now()`

12. **`public.manual_payouts`** *(Created exclusively by Owner; defined before `rider_earnings` FK)*
    - `id uuid primary key default gen_random_uuid()`, `legacy_id text unique`
    - `rider_id uuid not null references public.profiles(id)`
    - `rider_name text not null` *(snapshot)*
    - `amount numeric(10,2) not null check (amount > 0)`
    - `reference_number text not null`, `method_note text not null`
    - `recorded_by uuid not null references public.profiles(id)`, `recorded_by_email text not null`
    - `recorded_at timestamptz not null default now()`

13. **`public.rider_earnings`**
    - `id uuid primary key default gen_random_uuid()`, `legacy_id text unique`
    - `order_id uuid not null unique references public.orders(id) on delete cascade` *(prevents duplicate earnings per order)*
    - `order_number text not null`, `restaurant_name text not null` *(snapshots)*
    - `rider_id uuid not null references public.profiles(id)`
    - `amount numeric(10,2) not null check (amount >= 0)`
    - `payout_status text not null default 'UNPAID_PENDING_MANUAL_REVIEW' check (payout_status in ('UNPAID_PENDING_MANUAL_REVIEW', 'SETTLED_MANUALLY'))`
    - `manual_payout_id uuid references public.manual_payouts(id)`
    - `completed_at timestamptz not null default now()`

14. **`public.rider_approval_history`** *(Append-only decision trail)*
    - `id uuid primary key default gen_random_uuid()`, `legacy_id text unique`
    - `rider_id uuid not null references public.profiles(id) on delete cascade`
    - `rider_name text not null`, `rider_email text not null`
    - `target text not null check (target in ('DOCUMENTS', 'SERVICE_FOOD_DELIVERY', 'REGISTRATION'))`
    - `service_key text check (service_key in ('FOOD_DELIVERY', 'GROCERY', 'PARCEL', 'BIKE_TAXI'))`
    - `previous_status text check (previous_status in ('PENDING', 'APPROVED', 'REJECTED', 'NONE'))`
    - `new_status text not null check (new_status in ('PENDING', 'APPROVED', 'REJECTED'))`
    - `reason text not null`, `actor_id text not null`, `actor_role text not null`, `actor_email text not null`
    - `timestamp timestamptz not null default now()`

15. **`public.audit_logs`** *(Append-only platform security/governance log)*
    - `id uuid primary key default gen_random_uuid()`, `legacy_id text unique`
    - `timestamp timestamptz not null default now()`, `actor_id text not null`, `actor_role text not null`, `actor_email text not null`, `action text not null`, `target text not null`, `details text not null`

### 4.2 Required Performance Indexes
```sql
create index if not exists idx_profiles_role_created on public.profiles (role, created_at desc);
create unique index if not exists idx_profiles_email_lower on public.profiles (lower(email));
create unique index if not exists idx_profiles_auth_user_id on public.profiles (auth_user_id) where auth_user_id is not null;
create index if not exists idx_rider_service_approvals_rider on public.rider_service_approvals (rider_id, service_key);
create index if not exists idx_menu_items_restaurant on public.menu_items (restaurant_id, is_available);
create index if not exists idx_orders_customer_created on public.orders (customer_id, created_at desc);
create index if not exists idx_orders_rider_status on public.orders (assigned_rider_id, updated_at desc);
create index if not exists idx_orders_status_created on public.orders (status, created_at desc);
create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_rider_earnings_rider_status on public.rider_earnings (rider_id, payout_status);
create index if not exists idx_manual_payouts_rider_time on public.manual_payouts (rider_id, recorded_at desc);
create index if not exists idx_rider_approval_history_rider_time on public.rider_approval_history (rider_id, timestamp desc);
create index if not exists idx_audit_logs_time on public.audit_logs (timestamp desc);
```

---

## 5. Row Level Security (RLS), Service-Role Boundaries & Private Document Storage

### 5.1 Crucial Architectural Fact: `service_role` Bypasses RLS & `auth.uid()` Identity Helpers
- **Important**: Any Supabase client initialized with `SUPABASE_SERVICE_ROLE_KEY` in `server.ts` **completely bypasses all RLS policies**.
- Therefore:
  1. Express middleware (`requireAuth(['CUSTOMER' | 'RIDER' | 'OWNER'])`) and explicit ownership predicates (`customer_id = req.auth.userId`, `assigned_rider_id = req.auth.userId`, dual-approval checks) remain **mandatory** inside `server.ts` — never rely on RLS to filter `service_role` queries.
  2. RLS on all 15 `public.*` tables acts as **strict defense-in-depth** blocking any unauthorized direct PostgREST access via `VITE_SUPABASE_ANON_KEY` or a compromised user JWT.
  3. **Mapping `auth.uid()` to `public.profiles.id`**: Because Supabase Auth generates its own `auth.users.id`, **`auth.uid()` is NOT assumed equal to `profiles.id`**. Instead, all RLS policies resolve identity through two hardened `SECURITY DEFINER` helpers (`set search_path = public`):
     ```sql
     create or replace function public.current_profile_id()
     returns uuid
     language sql
     stable
     security definer
     set search_path = public
     as $$
       select id
       from public.profiles
       where auth_user_id = auth.uid()
       limit 1;
     $$;

     create or replace function public.current_user_role()
     returns text
     language sql
     stable
     security definer
     set search_path = public
     as $$
       select role
       from public.profiles
       where auth_user_id = auth.uid()
         and status = 'ACTIVE'
       limit 1;
     $$;
     ```

### 5.2 Role-Isolated RLS Policies & Column-Level Update Protection

| Table | `CUSTOMER` | `RIDER` | `OWNER` / Super Admin |
|---|---|---|---|
| `private_auth.legacy_credentials` | **No access** (schema not exposed). | **No access**. | **No direct PostgREST access** (server `service_role` only). |
| `profiles` | `SELECT` own row (`auth_user_id = auth.uid()`). `UPDATE` (`auth_user_id = auth.uid()`) restricted via `REVOKE UPDATE ON public.profiles FROM authenticated; GRANT UPDATE (name, phone, saved_address) ON public.profiles TO authenticated;` + `BEFORE UPDATE` trigger blocking changes to `id`, `auth_user_id`, `role`, `status`, `document_status`, `approval_status`, `is_online` by non-`service_role`. Public `INSERT` allowed only for `auth_user_id = auth.uid()`, `role = 'CUSTOMER'`, `status = 'ACTIVE'`. | `SELECT` own row (`auth_user_id = auth.uid()`); `UPDATE` (`auth_user_id = auth.uid()`) restricted to `(name, phone, city_area)` via column grants + trigger (cannot modify `id`, `auth_user_id`, `role`, or self-approve / force `is_online = true`). Public `INSERT` allowed only for `auth_user_id = auth.uid()`, `role = 'RIDER'`, `document_status = 'PENDING'`, `approval_status = 'PENDING'`, `is_online = false`. | `SELECT` all rows (`public.current_user_role() = 'OWNER'`); all privileged updates via server-side Owner API. Public `INSERT` with `role = 'OWNER'` is **blocked**. |
| `rider_documents` | **No access** (`0` rows). | `SELECT` own row (`rider_id = public.current_profile_id()`) only; writes routed exclusively through Express `POST /api/rider/documents` (so resubmission atomically resets `document_status = 'PENDING'` and logs `rider_approval_history`). | `SELECT` all rows (`public.current_user_role() = 'OWNER'`). |
| `rider_service_approvals` | **No access**. | `SELECT` own rows (`rider_id = public.current_profile_id()`, read-only). | `SELECT` all rows (`public.current_user_role() = 'OWNER'`); `INSERT`/`UPDATE` via server-side Owner API only. |
| `restaurants`, `menu_items`, `pricing_settings`, `service_zones` | `SELECT` public (`using (true)`). | `SELECT` public (`using (true)`). | `SELECT` public; writes via server-side Owner API only. |
| `orders` & `order_items` | `SELECT` own orders (`customer_id = public.current_profile_id()` on `orders`; `exists` join on `order_items`). Writes routed via `POST /api/orders` only (prevents client price/fee tampering). | `SELECT` assigned orders (`assigned_rider_id = public.current_profile_id()`). Status changes via server routes only. | `SELECT` all orders (`public.current_user_role() = 'OWNER'`); status/dispatch updates via server-side Owner API. |
| `payments` & `refunds` | `SELECT` own order records (`exists (select 1 from public.orders o where o.id = order_id and o.customer_id = public.current_profile_id())`). | `SELECT` payment method/status for assigned orders only (`o.assigned_rider_id = public.current_profile_id()`); no write access. | Full read/manage (`public.current_user_role() = 'OWNER'`) via server-side Owner API. |
| `rider_earnings` & `manual_payouts` | **No access**. | `SELECT` own rows (`rider_id = public.current_profile_id()`, read-only). | `SELECT` all rows (`public.current_user_role() = 'OWNER'`); `INSERT`/`UPDATE` via server-side Owner API only. |
| `rider_approval_history` | **No access**. | `SELECT` own rows (`rider_id = public.current_profile_id()`, read-only). | `SELECT` all rows (`public.current_user_role() = 'OWNER'`); append-only via server-side API. |
| `audit_logs` | **No access**. | **No access**. | `SELECT` all rows (`public.current_user_role() = 'OWNER'`); append-only via server-side API. |

### 5.3 Secure Private Storage for Rider Documents (`storage.objects`)
- Even though the current MVP uses dummy string references (and blocks numeric Aadhaar/bank strings), transitioning to uploaded document images/PDFs requires:
  - A **private** bucket `rider-kyc-docs` (`public = false`) with MIME-type allowlist (`image/jpeg`, `image/png`, `application/pdf`) and `5 MB` max object size.
  - Storage RLS keyed to the canonical profile folder `(storage.foldername(name))[1] = public.current_profile_id()::text` (with `public.current_user_role() = 'RIDER'`) so folder paths always match `rider_documents.rider_id` / `profiles.id` rather than `auth.uid()`, preventing Riders from reading or overwriting other Riders' documents even when `auth.users.id !== profiles.id`.
  - Owners view uploaded documents strictly via short-lived server-generated **Signed URLs** (`60s` TTL) issued after `requireAuth(['OWNER'])` — never public URLs.
  - Real Aadhaar numbers must **never** be stored in plain DB columns or unencrypted buckets; integrate a licensed KYC provider (DigiLocker / IDfy) storing only tokenized/masked verification references.

---

## 6. Operations That MUST Remain Server-Side

All client portals continue calling Express `/api/*` routes backed by `SUPABASE_SERVICE_ROLE_KEY`. The browser must **never** write directly to Supabase tables for privileged transitions:

1. **Password Verification & Auth Upgrades**: `scrypt` check against `private_auth.legacy_credentials`, transparent Supabase Auth upgrade, `OWNER_ADMIN_EMAIL`/`OWNER_ADMIN_PASSCODE` constant-time checks, rate-limiting, and persistent `SESSION_SECRET` token signing.
2. **Public Signup Restriction**: Blocking `role === 'OWNER'` on `POST /api/auth/register` and rejecting 9–18 digit numeric Aadhaar/bank account inputs.
3. **Rider Document & Service Approval Decisions**: Separate `documentStatus` and `serviceApprovals.FOOD_DELIVERY` transitions, mandatory rejection reasons (`>= 3` chars), automatic reset to `PENDING` + offline on document resubmission, and append-only `rider_approval_history`.
4. **Rider Online Eligibility Gate**: Requiring `documentStatus === 'APPROVED' && FOOD_DELIVERY === 'APPROVED'` on `PATCH /api/rider/availability`.
5. **Order Pricing & Service Validation**: Rejecting disabled services (`GROCERY`, `PARCEL`, `BIKE_TAXI`), computing totals and `rider_fee` from `pricing_settings` + `menu_items`, and generating atomic `YUP-*` numbers from `order_number_seq`.
6. **Rider Dispatch Assignment**: Verifying `ACTIVE`, dual-approved, `isOnline = true` riders on `POST /api/owner/orders/:orderId/assign-rider`.
7. **Earnings Accrual & Manual Payouts**: Inserting `UNPAID_PENDING_MANUAL_REVIEW` earnings (`unique(order_id)`) and recording `manual_payouts` validated against `pendingManualPayout` inside a database transaction (`RPC` / Postgres function).
8. **Immutable Audit Logging**: Writing `audit_logs` on every privileged event.

---

## 7. Safe Environment Variable Setup

| Variable | Scope | Exposure Rule | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | Server-only (`server.ts`) | Server env | Server Supabase connection |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** (`server.ts`) | **NEVER** prefix with `VITE_`; never commit or send to browser | Trusted Express backend & migration scripts (bypasses RLS) |
| `SESSION_SECRET` | **Server-only** (`server.ts`) | **NEVER** prefix with `VITE_` | Required persistent HMAC signing secret in production |
| `OWNER_ADMIN_EMAIL` / `OWNER_ADMIN_PASSCODE` | **Server-only** (`server.ts`) | **NEVER** prefix with `VITE_` | Private Owner credentials |
| `OWNER_BOOTSTRAP_SECRET` | **Server-only** (`server.ts`) | **NEVER** prefix with `VITE_` | Protects one-time Owner claim if env credentials aren't pre-set |
| `VITE_SUPABASE_URL` | Frontend-safe (`src/lib/supabase.ts`) | Public URL only | Optional read-only Supabase client initialization |
| `VITE_SUPABASE_ANON_KEY` | Frontend-safe (`src/lib/supabase.ts`) | Public anon key constrained by RLS | Safe only when Section 5 RLS + column grants are applied |

---

## 8. Phased Zero-Data-Loss Migration Plan

1. **Phase 0 — Pre-Migration Snapshot**:
   - Export and SHA-256 checksum `/data/store.json` (`cp data/store.json backups/store-pre-migration.json`).
2. **Phase 1 — Provision Supabase & Apply Final SQL Schema + Triggers + RLS**:
   - Create Supabase project, configure server secrets, create `private_auth` schema + 15 `public` tables + `order_number_seq` + indexes + `BEFORE UPDATE` column protection triggers + RLS + `rider-kyc-docs` private Storage bucket.
3. **Phase 2 — Idempotent Data Backfill (`scripts/migrate-store-to-supabase.ts`, `--dry-run` first)**:
   - Pre-flight check aborts on any duplicate `lower(email)` across `store.users`, `ownerCredential`, and `OWNER_ADMIN_EMAIL`.
   - Deterministic FK order inside per-entity transactions using `ON CONFLICT (legacy_id) DO NOTHING / DO UPDATE` and unique constraints (`lower(email)`, `order_number`, `(rider_id, service_key)`, `order_id` on `rider_earnings`) so re-runs after interruption cannot duplicate records:
     1. `pricing_settings` (`id = 1`)
     2. `profiles` (`cust-*`, riders, and Owner row `'owner-1'` / `'owner-env'` with generated `profiles.id` and `auth_user_id = NULL`) + `private_auth.legacy_credentials` (`scrypt` hashes & salts, `migration_state = 'PENDING'`). Legacy users without `auth.users` rows are **not** pre-created with dummy passwords; they are created JIT after `scrypt` verification via `auth.admin.createUser()` (allowing Supabase Auth to generate its own `auth.users.id`, then linking `profiles.auth_user_id`). Owner accounts may be provisioned via CLI + `signInWithPassword` check at cutover (Section 3.6).
     3. `rider_documents` & `rider_service_approvals`
     4. `restaurants` & `menu_items`
     5. `orders` (preserving `customer_name`, `restaurant_name`, `assigned_rider_*` snapshots), `order_items`, and `payments`
     6. `manual_payouts` -> `rider_earnings` (reconciling `manual_payout_id` UUIDs)
     7. `rider_approval_history` & `audit_logs`
     8. Advance `order_number_seq` via `setval('public.order_number_seq', GREATEST(store.orderCounter, max_numeric_order_num), true)`.
4. **Phase 3 — Repository Abstraction (`StoreRepository`)**:
   - Implement `JsonStoreRepository` and `SupabaseStoreRepository` behind `STORAGE_DRIVER=json|supabase` in `server.ts`, preserving all 32 Express API contracts and frontend portals unchanged.
   - Wrap multi-row mutations (`POST /api/orders`, `POST /api/rider/jobs/:id/complete`, `POST /api/owner/payouts`) in PostgreSQL RPC transactions to prevent partial-write race conditions.
5. **Phase 4 — Cutover, Burn-In & Legacy Hash Retirement**:
   - Enter brief maintenance mode, run final migration diff, verify exact row counts + financial totals (`SUM(rider_earnings.amount)`, `SUM(manual_payouts.amount)`), flip `STORAGE_DRIVER=supabase`, and run `private_auth.legacy_credentials` JIT login upgrades during a 7–14 day burn-in window before retiring verified `scrypt` hashes.

---

## 9. Testing, Backup, Rollback & Recovery Plan

- **Pre-Cutover Verification**:
  - Run `--dry-run` and `--verify` against staging Supabase; run migration twice to prove **0 duplicate rows**; verify financial parity (`totalEarned`, `totalPaidManually`, `pendingManualPayoutTotal`) and sequence value (`order_number_seq > max order`).
  - Run full role regression tests (Customer order/pickup, Rider onboarding -> separate Doc + Food Delivery approvals -> dual-approval online gate -> completion -> manual payout) plus automated RLS penetration tests proving `anon`/Customer/Rider JWTs cannot escalate `profiles.document_status`/`role`/`is_online`, read `audit_logs` or `private_auth`, or create `OWNER` accounts.
- **Backup & Recovery**:
  - Retain immutable `/data/store.json` pre-cutover snapshots + run `pg_dump` before cutover and before any schema change (note: Free Tier lacks built-in daily backups/PITR, so external `pg_dump` cron backups are required if on Free Tier).
- **Post-Cutover Rollback Protocol (Preventing Data Loss & Order Collisions)**:
  - **Before live traffic writes**: Restore pre-cutover `store.json`, set `STORAGE_DRIVER=json`, restart Express.
  - **After live traffic writes have occurred in Supabase**:
    1. Place Express briefly in maintenance mode (`503`) to stop concurrent writes.
    2. Run `scripts/export-supabase-to-store.ts` to export all current Supabase tables (including `profiles`, `private_auth.legacy_credentials`, `orders`, `rider_earnings`, `manual_payouts`, `rider_approval_history`, `audit_logs`, and `MAX(numeric order_number)` into `orderCounter`) into a verified `store.rollback.json`.
    3. Swap `store.rollback.json` -> `/data/store.json`, flip `STORAGE_DRIVER=json`, and restart Express.
    4. *Constraint*: Users whose legacy `scrypt` hash was already cleared post-burn-in would need a password reset upon rollback; retaining `private_auth.legacy_credentials` during the 7–14 day burn-in window keeps rollback seamless.

---

## 10. Verified Supabase Pricing, Free-Tier Limitations & External Services

*(Verified against current official Supabase Plan limits at `supabase.com/pricing`)*:

- **Supabase Free Plan ($0/month)**:
  - **2** active projects max; shared CPU / **~500 MB RAM** per project.
  - **500 MB** PostgreSQL database storage per project; **1 GB** file storage.
  - **50,000** monthly active users (MAUs).
  - **5 GB** uncached egress + **5 GB** cached egress per month.
  - **Auto-pausing**: Free projects pause after **7 days (1 week) of inactivity**, causing runtime downtime until manually resumed.
  - **No automated backups or PITR**: Free Tier includes **0** daily backups and **0** Point-in-Time Recovery (requires external `pg_dump` backups).
- **Supabase Pro Plan (Starts at $25/month per organization; includes $10/month compute credit covering 1 Micro 1 GB RAM instance)**:
  - **8 GB** database disk per project included (`$0.125/GB` overage); **100 GB** file storage included (`$0.0213/GB` overage).
  - **100,000** MAUs included (`$0.00325/MAU` overage).
  - **250 GB** uncached egress (`$0.09/GB` overage) + **250 GB** cached egress (`$0.03/GB` overage).
  - **Production Reliability**: **No 7-day auto-pausing**, **automated daily backups (7-day retention)**, and a default **Spend Cap** to guard against unexpected usage spikes.
  - **Compute & PITR Add-ons**: Running more than 1 Micro instance or upgrading compute size (`Small` / `Medium`+) incurs additional compute charges beyond the included `$10/month` compute credit. **Point-in-Time Recovery (PITR)** is a separate paid add-on starting at **$100/month**.
- **Express Hosting & Future External Services**:
  - **Node/Express Host (e.g., Cloud Run)**: `~$0–$15/month` at low MVP traffic.
  - **Future External Services (Not Needed for Current MVP)**: Payment gateway (Razorpay/Cashfree/Stripe, ~2% fee), licensed KYC provider (DigiLocker/IDfy), Google Maps Platform (distance/live tracking), and SMS/OTP gateway (MSG91/Twilio).
