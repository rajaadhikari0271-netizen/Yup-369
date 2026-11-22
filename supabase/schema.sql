-- Yup! 369 — Production Supabase PostgreSQL Schema, Auth Migration Isolation & RLS
-- Source of Truth: DATABASE_MIGRATION_PLAN.md
-- Target: Fresh Supabase project (PostgreSQL + Supabase Auth + Private Storage)
--
-- IMPORTANT:
--   * Do NOT execute automatically against local JSON MVP runtime.
--   * Preserves canonical public.profiles(id) UUIDs for all historical foreign keys.
--   * Stores Supabase Auth-generated UUIDs separately in public.profiles(auth_user_id).
--   * Resolves all RLS checks via auth_user_id = auth.uid() -> public.current_profile_id()
--     and public.current_user_role(), never assuming auth.uid() = profiles.id.

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. ISOLATED PRIVATE AUTH SCHEMA (Never exposed via PostgREST / Data API)
-- ============================================================================
create schema if not exists private_auth;

revoke all on schema private_auth from public, anon, authenticated;
grant usage on schema private_auth to service_role;

-- ============================================================================
-- 2. PUBLIC DOMAIN TABLES (15 Tables + 1 Order Sequence)
-- ============================================================================

-- 2.1 Service Zones (Normalized cities & areas; additive to free-text city_area)
create table if not exists public.service_zones (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  area_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (city, area_name)
);

-- 2.2 Profiles (Customers, Riders, Owners — canonical identity table; zero password columns)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  legacy_id text unique,
  role text not null check (role in ('CUSTOMER', 'RIDER', 'OWNER')),
  name text not null,
  email text not null unique,
  phone text not null,
  city_area text,
  zone_id uuid references public.service_zones(id) on delete set null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  saved_address text,
  approval_status text check (approval_status in ('PENDING', 'APPROVED', 'REJECTED')),
  document_status text check (document_status in ('PENDING', 'APPROVED', 'REJECTED')),
  document_notes text,
  approval_notes text,
  is_online boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2.3 Isolated Legacy scrypt Credentials (private_auth schema; service_role only)
create table if not exists private_auth.legacy_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  password_hash text,
  password_salt text,
  migration_state text not null default 'PENDING'
    check (migration_state in ('PENDING', 'IN_PROGRESS', 'VERIFIED', 'RETIRED')),
  migrated_auth_user_id uuid,
  verified_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

revoke all on all tables in schema private_auth from public, anon, authenticated;
grant all on all tables in schema private_auth to service_role;
alter default privileges in schema private_auth revoke all on tables from public, anon, authenticated;

-- 2.4 Rider Verification Documents & Dummy Bank Structure (1:1 with Rider profile)
create table if not exists public.rider_documents (
  rider_id uuid primary key references public.profiles(id) on delete cascade,
  dummy_gov_id_ref text not null,
  dummy_license_ref text not null,
  dummy_vehicle_plate text not null,
  dummy_vehicle_type text not null
    check (dummy_vehicle_type in ('Scooter', 'Motorcycle', 'E-Bike', 'Bicycle')),
  dummy_payout_ref text not null,
  dummy_bank_details jsonb not null,
  storage_object_paths jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);

-- 2.5 Rider Per-Service Approvals (Separate approval state per service vertical)
create table if not exists public.rider_service_approvals (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  service_key text not null check (service_key in ('FOOD_DELIVERY', 'GROCERY', 'PARCEL', 'BIKE_TAXI')),
  requested boolean not null default false,
  status text not null default 'DISABLED'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED')),
  notes text,
  updated_at timestamptz not null default now(),
  unique (rider_id, service_key)
);

-- 2.6 Restaurants
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  cuisine text not null,
  address text not null,
  zone_id uuid references public.service_zones(id) on delete set null,
  prep_time_mins integer not null default 25 check (prep_time_mins between 5 and 120),
  rating numeric(2,1) not null default 4.5,
  image_url text not null,
  is_open boolean not null default true,
  supports_delivery boolean not null default true,
  supports_self_pickup boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2.7 Menu Items
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text not null,
  category text not null,
  price numeric(10,2) not null check (price >= 0),
  is_veg boolean not null default true,
  is_available boolean not null default true
);

-- 2.8 Pricing Settings (Singleton configuration row id = 1, managed by Owner)
create table if not exists public.pricing_settings (
  id integer primary key default 1 check (id = 1),
  base_delivery_fee numeric(10,2) not null default 29,
  free_delivery_threshold numeric(10,2) not null default 399,
  platform_fee numeric(10,2) not null default 6,
  self_pickup_fee numeric(10,2) not null default 0,
  rider_commission_percent integer not null default 80
    check (rider_commission_percent between 10 and 100),
  updated_at timestamptz not null default now()
);

-- 2.9 Orders & Atomic Order Number Sequence (FOOD_DELIVERY and SELF_PICKUP only in MVP)
create sequence if not exists public.order_number_seq
  as bigint
  start with 1001
  increment by 1
  minvalue 1;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  order_number text not null unique default ('YUP-' || nextval('public.order_number_seq')::text),
  customer_id uuid not null references public.profiles(id),
  customer_name text not null,
  customer_phone text not null,
  restaurant_id uuid not null references public.restaurants(id),
  restaurant_name text not null,
  restaurant_address text not null,
  service_type text not null check (service_type in ('FOOD_DELIVERY', 'SELF_PICKUP')),
  subtotal numeric(10,2) not null check (subtotal >= 0),
  delivery_fee numeric(10,2) not null check (delivery_fee >= 0),
  platform_fee numeric(10,2) not null check (platform_fee >= 0),
  total_amount numeric(10,2) not null check (total_amount >= 0),
  rider_fee numeric(10,2) not null default 0 check (rider_fee >= 0),
  delivery_address text,
  pickup_instructions text,
  payment_method text not null check (payment_method in ('CASH_ON_DELIVERY', 'PAY_AT_COUNTER')),
  payment_status text not null default 'PENDING_COLLECTION'
    check (payment_status in ('PENDING_COLLECTION', 'COLLECTED_ON_DELIVERY', 'PAID_AT_COUNTER')),
  status text not null default 'PLACED'
    check (status in ('PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'COMPLETED', 'CANCELLED')),
  assigned_rider_id uuid references public.profiles(id),
  assigned_rider_name text,
  assigned_rider_phone text,
  assigned_rider_plate text,
  rider_job_status text not null default 'UNASSIGNED'
    check (rider_job_status in ('UNASSIGNED', 'ASSIGNED', 'ACCEPTED', 'REJECTED', 'COMPLETED')),
  milestones jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.10 Order Items
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  quantity integer not null check (quantity > 0),
  is_veg boolean not null default true
);

-- 2.11 Payments (1:1 per order; mirrors COD / Pay-at-Counter and prepares gateway settlement)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  method text not null check (method in ('CASH_ON_DELIVERY', 'PAY_AT_COUNTER')),
  status text not null default 'PENDING_COLLECTION'
    check (status in ('PENDING_COLLECTION', 'COLLECTED_ON_DELIVERY', 'PAID_AT_COUNTER')),
  amount numeric(10,2) not null check (amount >= 0),
  provider_ref text,
  collected_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2.12 Refunds (Prepared for future manual/gateway refund workflows)
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  amount numeric(10,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'REJECTED')),
  processed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- 2.13 Manual Payout Records (Created exclusively by Owner; defined before rider_earnings FK)
create table if not exists public.manual_payouts (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  rider_id uuid not null references public.profiles(id),
  rider_name text not null,
  amount numeric(10,2) not null check (amount > 0),
  reference_number text not null,
  method_note text not null,
  recorded_by uuid not null references public.profiles(id),
  recorded_by_email text not null,
  recorded_at timestamptz not null default now()
);

-- 2.14 Rider Earnings Ledger (One earning row max per order; settled strictly manually)
create table if not exists public.rider_earnings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  order_number text not null,
  restaurant_name text not null,
  rider_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null check (amount >= 0),
  payout_status text not null default 'UNPAID_PENDING_MANUAL_REVIEW'
    check (payout_status in ('UNPAID_PENDING_MANUAL_REVIEW', 'SETTLED_MANUALLY')),
  manual_payout_id uuid references public.manual_payouts(id),
  completed_at timestamptz not null default now()
);

-- 2.15 Rider Approval History (Append-only document & service decision audit trail)
create table if not exists public.rider_approval_history (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  rider_name text not null,
  rider_email text not null,
  target text not null check (target in ('DOCUMENTS', 'SERVICE_FOOD_DELIVERY', 'REGISTRATION')),
  service_key text check (service_key in ('FOOD_DELIVERY', 'GROCERY', 'PARCEL', 'BIKE_TAXI')),
  previous_status text check (previous_status in ('PENDING', 'APPROVED', 'REJECTED', 'NONE')),
  new_status text not null check (new_status in ('PENDING', 'APPROVED', 'REJECTED')),
  reason text not null,
  actor_id text not null,
  actor_role text not null,
  actor_email text not null,
  timestamp timestamptz not null default now()
);

-- 2.16 Immutable Platform Audit Logs
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  timestamp timestamptz not null default now(),
  actor_id text not null,
  actor_role text not null,
  actor_email text not null,
  action text not null,
  target text not null,
  details text not null
);

-- ============================================================================
-- 3. PERFORMANCE & UNIQUENESS INDEXES
-- ============================================================================
create index if not exists idx_profiles_role_created on public.profiles (role, created_at desc);
create unique index if not exists idx_profiles_email_lower on public.profiles (lower(email));
create unique index if not exists idx_profiles_auth_user_id on public.profiles (auth_user_id)
  where auth_user_id is not null;
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

-- ============================================================================
-- 4. SECURITY DEFINER HELPERS & TRIGGERS
-- ============================================================================

-- 4.1 Lookup auth.users by normalized email for crash-recovery verification (service_role only)
create or replace function private_auth.find_auth_user_by_email(p_email text)
returns table (
  id uuid,
  email text,
  raw_app_meta_data jsonb
)
language sql
stable
security definer
set search_path = private_auth, auth, public
as $$
  select u.id, u.email::text, u.raw_app_meta_data
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function private_auth.find_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function private_auth.find_auth_user_by_email(text) to service_role;

-- 4.2 Map auth.uid() -> canonical public.profiles.id via auth_user_id
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

-- 4.3 Resolve active role safely via auth_user_id = auth.uid() (blocks SUSPENDED accounts)
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

revoke all on function public.current_profile_id() from public;
grant execute on function public.current_profile_id() to authenticated, anon, service_role;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated, anon, service_role;

-- 4.4 Automatic updated_at trigger
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_legacy_credentials_updated_at on private_auth.legacy_credentials;
create trigger trg_legacy_credentials_updated_at
  before update on private_auth.legacy_credentials
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_rider_service_approvals_updated_at on public.rider_service_approvals;
create trigger trg_rider_service_approvals_updated_at
  before update on public.rider_service_approvals
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_pricing_settings_updated_at on public.pricing_settings;
create trigger trg_pricing_settings_updated_at
  before update on public.pricing_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- 4.5 Prevent non-service_role updates to privileged or role-locked profile columns
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if jwt_role <> 'service_role' and current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id
      or new.auth_user_id is distinct from old.auth_user_id
      or new.legacy_id is distinct from old.legacy_id
      or new.role is distinct from old.role
      or new.email is distinct from old.email
      or new.zone_id is distinct from old.zone_id
      or new.status is distinct from old.status
      or new.approval_status is distinct from old.approval_status
      or new.document_status is distinct from old.document_status
      or new.document_notes is distinct from old.document_notes
      or new.approval_notes is distinct from old.approval_notes
      or new.is_online is distinct from old.is_online
      or new.created_at is distinct from old.created_at then
      raise exception 'Modification of protected profile fields is restricted to server service_role';
    end if;

    if old.role = 'CUSTOMER' and new.city_area is distinct from old.city_area then
      raise exception 'Customers cannot modify city_area';
    end if;

    if old.role = 'RIDER' and new.saved_address is distinct from old.saved_address then
      raise exception 'Riders cannot modify saved_address';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_privileged_columns on public.profiles;
create trigger trg_profiles_protect_privileged_columns
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- ============================================================================
-- 5. COLUMN-LEVEL GRANTS & ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Column-level self-service update protection on public.profiles
revoke insert, update, delete on public.profiles from anon;
revoke update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (auth_user_id, role, name, email, phone, city_area, status, saved_address, approval_status, document_status, is_online)
  on public.profiles to authenticated;
grant update (name, phone, saved_address, city_area) on public.profiles to authenticated;

-- Enable RLS across private_auth and all 15 public tables
alter table private_auth.legacy_credentials enable row level security;
alter table public.service_zones enable row level security;
alter table public.profiles enable row level security;
alter table public.rider_documents enable row level security;
alter table public.rider_service_approvals enable row level security;
alter table public.restaurants enable row level security;
alter table public.menu_items enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.manual_payouts enable row level security;
alter table public.rider_earnings enable row level security;
alter table public.rider_approval_history enable row level security;
alter table public.audit_logs enable row level security;

-- 5.1 Public Catalog Tables (Read-only to clients; writes via server service_role)
drop policy if exists "Public read service zones" on public.service_zones;
create policy "Public read service zones"
  on public.service_zones for select
  using (true);

drop policy if exists "Public read restaurants" on public.restaurants;
create policy "Public read restaurants"
  on public.restaurants for select
  using (true);

drop policy if exists "Public read menu items" on public.menu_items;
create policy "Public read menu items"
  on public.menu_items for select
  using (true);

drop policy if exists "Public read pricing" on public.pricing_settings;
create policy "Public read pricing"
  on public.pricing_settings for select
  using (true);

-- 5.2 Profiles (auth_user_id = auth.uid(); no Owner signup; no self-approval)
drop policy if exists "Profiles select own or owner" on public.profiles;
create policy "Profiles select own or owner"
  on public.profiles for select
  using (
    auth_user_id = auth.uid()
    or public.current_user_role() = 'OWNER'
  );

drop policy if exists "Customers insert own initial profile" on public.profiles;
create policy "Customers insert own initial profile"
  on public.profiles for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and role = 'CUSTOMER'
    and status = 'ACTIVE'
    and approval_status is null
    and document_status is null
    and is_online = false
  );

drop policy if exists "Riders insert own initial pending profile" on public.profiles;
create policy "Riders insert own initial pending profile"
  on public.profiles for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and role = 'RIDER'
    and status = 'ACTIVE'
    and document_status = 'PENDING'
    and approval_status = 'PENDING'
    and is_online = false
  );

drop policy if exists "Customers and riders update own safe profile fields" on public.profiles;
create policy "Customers and riders update own safe profile fields"
  on public.profiles for update
  to authenticated
  using (
    auth_user_id = auth.uid()
    and status = 'ACTIVE'
    and role in ('CUSTOMER', 'RIDER')
  )
  with check (
    auth_user_id = auth.uid()
    and status = 'ACTIVE'
    and role in ('CUSTOMER', 'RIDER')
  );

-- 5.3 Rider Documents & Per-Service Approvals (Read own for Rider; Read all for Owner; writes server-only)
drop policy if exists "Riders view own documents; owners view all" on public.rider_documents;
create policy "Riders view own documents; owners view all"
  on public.rider_documents for select
  using (
    rider_id = public.current_profile_id()
    or public.current_user_role() = 'OWNER'
  );

drop policy if exists "Riders view own service approvals; owners view all" on public.rider_service_approvals;
create policy "Riders view own service approvals; owners view all"
  on public.rider_service_approvals for select
  using (
    rider_id = public.current_profile_id()
    or public.current_user_role() = 'OWNER'
  );

-- 5.4 Orders, Order Items, Payments & Refunds
drop policy if exists "Orders select customer, assigned rider, or owner" on public.orders;
create policy "Orders select customer, assigned rider, or owner"
  on public.orders for select
  using (
    customer_id = public.current_profile_id()
    or assigned_rider_id = public.current_profile_id()
    or public.current_user_role() = 'OWNER'
  );

drop policy if exists "Order items select via visible order" on public.order_items;
create policy "Order items select via visible order"
  on public.order_items for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_id
        and (
          o.customer_id = public.current_profile_id()
          or o.assigned_rider_id = public.current_profile_id()
          or public.current_user_role() = 'OWNER'
        )
    )
  );

drop policy if exists "Payments select customer, assigned rider, or owner" on public.payments;
create policy "Payments select customer, assigned rider, or owner"
  on public.payments for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_id
        and (
          o.customer_id = public.current_profile_id()
          or o.assigned_rider_id = public.current_profile_id()
          or public.current_user_role() = 'OWNER'
        )
    )
  );

drop policy if exists "Refunds select customer, assigned rider, or owner" on public.refunds;
create policy "Refunds select customer, assigned rider, or owner"
  on public.refunds for select
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_id
        and (
          o.customer_id = public.current_profile_id()
          or o.assigned_rider_id = public.current_profile_id()
          or public.current_user_role() = 'OWNER'
        )
    )
  );

-- 5.5 Financial & Governance Tables (Read own for Rider; Read all for Owner; writes server-only)
drop policy if exists "Riders view own earnings; owners view all" on public.rider_earnings;
create policy "Riders view own earnings; owners view all"
  on public.rider_earnings for select
  using (
    rider_id = public.current_profile_id()
    or public.current_user_role() = 'OWNER'
  );

drop policy if exists "Riders view own manual payouts; owners view all" on public.manual_payouts;
create policy "Riders view own manual payouts; owners view all"
  on public.manual_payouts for select
  using (
    rider_id = public.current_profile_id()
    or public.current_user_role() = 'OWNER'
  );

drop policy if exists "Riders view own approval history; owners view all" on public.rider_approval_history;
create policy "Riders view own approval history; owners view all"
  on public.rider_approval_history for select
  using (
    rider_id = public.current_profile_id()
    or public.current_user_role() = 'OWNER'
  );

drop policy if exists "Owners view audit logs" on public.audit_logs;
create policy "Owners view audit logs"
  on public.audit_logs for select
  using (public.current_user_role() = 'OWNER');

-- ============================================================================
-- 6. PRIVATE STORAGE BUCKET & STORAGE RLS FOR RIDER KYC DOCUMENTS
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rider-kyc-docs',
  'rider-kyc-docs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Riders select own KYC objects; owners select all" on storage.objects;
create policy "Riders select own KYC objects; owners select all"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'rider-kyc-docs'
    and (
      (
        public.current_user_role() = 'RIDER'
        and (storage.foldername(name))[1] = public.current_profile_id()::text
      )
      or public.current_user_role() = 'OWNER'
    )
  );

drop policy if exists "Riders upload KYC objects into own profile folder" on storage.objects;
create policy "Riders upload KYC objects into own profile folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'rider-kyc-docs'
    and public.current_user_role() = 'RIDER'
    and (storage.foldername(name))[1] = public.current_profile_id()::text
  );
