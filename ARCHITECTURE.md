# Yup! 369 — System Architecture

## 1. Overview
**Yup! 369** is a mobile-first Progressive Web App (PWA) built with React 19, TypeScript, Vite, Tailwind CSS v4, and an Express API server (`server.ts`) paired with a Supabase-ready PostgreSQL schema (`supabase/schema.sql`) and client adapter (`src/lib/supabase.ts`).

The MVP supports **exactly three account roles**:
1. **Customer** — Browse kitchens, search dishes, manage cart, place Food Delivery or Self-Pickup orders, track honest milestones, manage profile.
2. **Rider** — One unified Rider account with 5-section onboarding: (1) Personal info & city/area, (2) Vehicle info (type, plate, dummy driving licence, dummy gov ID), (3) Service selection (`FOOD_DELIVERY` active; `GROCERY`, `PARCEL`, `BIKE_TAXI` disabled), (4) Document submission status (`PENDING | APPROVED | REJECTED`), and (5) Dummy bank details structure. Online/offline availability requires Owner approval of both documents and `FOOD_DELIVERY` service.
3. **Owner / Super Admin** — Private administrative portal with full platform oversight: KPIs, customer account governance, dedicated Owner Rider Approval Dashboard (name/email search, pending/approved/rejected filtering, vehicle & document inspection, separate document & Food Delivery approvals with required rejection reasons, and persisted approval history), restaurant & menu CRUD, order status & rider dispatch, pricing settings, manual payout recording, and immutable audit logs.

---

## 2. Service Scope & Honest Boundaries
- **Active Services**:
  - `FOOD_DELIVERY` (Cash on Delivery)
  - `SELF_PICKUP` (Pay at Restaurant Counter)
- **Disabled Services (Locked in UI & Rejected by API)**:
  - `GROCERY`, `PARCEL`, `BIKE_TAXI` — Explicitly disabled across customer checkout, unified rider registration/service approvals, and `POST /api/orders` / `PATCH /api/owner/riders/:id/service-approval` validation until implemented and approved.
- **No Simulated Telemetry or Fake Payments**:
  - Order tracking uses honest timestamped milestones (`PLACED`, `CONFIRMED`, `PREPARING`, `READY_FOR_PICKUP`, `PICKED_UP`, `COMPLETED`) with zero fake GPS map movement.
  - Checkout uses `CASH_ON_DELIVERY` or `PAY_AT_COUNTER` (`PENDING_COLLECTION`) with zero fake online payment gateway success screens.
  - Rider payouts are queued as `UNPAID_PENDING_MANUAL_REVIEW` and can only be settled manually by the Owner via `POST /api/owner/payouts`.

---

## 3. Security & Authentication Model
- **Password Hashing**: `crypto.scryptSync` with per-user 16-byte random salt and `crypto.timingSafeEqual` verification.
- **Session Tokens**: HMAC-SHA256 signed `Authorization: Bearer <token>` held strictly in React/JS memory (`src/services/api.ts`) — never persisted in `localStorage` or `sessionStorage`.
- **No Public Owner Registration**:
  - `POST /api/auth/register` strictly restricts `role` to `CUSTOMER` or `RIDER` and returns `403` for `OWNER`.
  - Owner login is isolated to `/api/auth/owner-login` using server-side `OWNER_ADMIN_EMAIL` and `OWNER_ADMIN_PASSCODE` environment variables.
  - When `OWNER_ADMIN_PASSCODE` is unset in preview environments, a one-time `/api/auth/owner-bootstrap` route allows claiming and hashing the Owner credentials once, after which bootstrap locks permanently.
- **Non-Sensitive Rider Verification**:
  - `POST /api/auth/register` (Rider) and `POST /api/rider/documents` explicitly block 9–18 digit numeric Aadhaar-like or real bank account strings, accepting only synthetic dummy references (`MOCK-ID-*`, `DUMMY-DL-*`, `TEST-ACCT-*`, `MOCK0003690`) and never auto-approving riders.

---

## 4. Supabase-Ready Migration Path
- `supabase/schema.sql` defines all normalized PostgreSQL tables (`profiles`, `rider_documents`, `rider_approval_history`, `restaurants`, `menu_items`, `pricing_settings`, `orders`, `order_items`, `rider_earnings`, `manual_payouts`, `audit_logs`) with Row-Level Security (RLS) policies blocking public `OWNER` profile insertion.
- `src/lib/supabase.ts` initializes `@supabase/supabase-js` whenever `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured.
- Until Supabase project keys are configured, `server.ts` persists state atomically to `data/store.json`.

---

## 5. PWA Configuration
- `vite-plugin-pwa` generates the Web App Manifest (`display: standalone`, `theme_color: #0B0B0D`, separate `any` and padded `maskable` 512×512 PNG icons) and Workbox precaching + Google Fonts runtime caching.
- `src/components/PWAInstallButton.tsx` handles Chromium `beforeinstallprompt` and provides guided iOS Safari instructions.
- `src/components/OfflineIndicator.tsx` listens to `navigator.onLine` events to notify users when offline.

---

## 6. Directory Structure
```text
├── server.ts                          # Express + Vite server, RBAC API, atomic store
├── supabase/
│   └── schema.sql                     # Supabase PostgreSQL schema & RLS policies
├── public/
│   ├── icon.svg                       # Brand vector icon
│   ├── apple-touch-icon.png           # 180x180 iOS home screen icon
│   ├── pwa-192x192.png                # 192x192 Android/Web icon
│   ├── pwa-512x512.png                # 512x512 Android/Web icon
│   └── pwa-maskable-512x512.png       # 512x512 maskable icon with safe-zone padding
├── src/
│   ├── types/domain.ts                # Shared TypeScript domain interfaces
│   ├── lib/supabase.ts                # Supabase client & configuration check
│   ├── services/api.ts                # Typed API wrapper with in-memory Bearer auth
│   ├── hooks/
│   │   ├── usePWAInstall.ts           # Install prompt & standalone mode hook
│   │   └── useOnlineStatus.ts         # Connectivity hook
│   └── components/
│       ├── BrandMark.tsx              # Yup! 369 brand mark, VegMarker, INR formatters
│       ├── AuthPortal.tsx             # Customer/Rider auth & Private Owner login
│       ├── PWAInstallButton.tsx       # Install prompt UI
│       ├── OfflineIndicator.tsx       # Offline status banner
│       ├── customer/CustomerPortal.tsx
│       ├── rider/RiderPortal.tsx
│       └── owner/OwnerPortal.tsx
├── ARCHITECTURE.md
└── DEVELOPMENT_STATUS.md
```
