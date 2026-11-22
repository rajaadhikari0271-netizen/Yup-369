-- Yup! 369 — Supabase-Ready PostgreSQL Schema & Row-Level Security (RLS)
-- Apply this schema in Supabase SQL Editor when transitioning from the local
-- Express MVP backend to managed Supabase PostgreSQL + Supabase Auth.

create extension if not exists "pgcrypto";

-- 1. Profiles (Customers, Riders, Owners)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('CUSTOMER', 'RIDER', 'OWNER')),
  name text not null,
  email text not null unique,
  phone text not null,
  city_area text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  saved_address text,
  approval_status text check (approval_status in ('PENDING', 'APPROVED', 'REJECTED')),
  document_status text check (document_status in ('PENDING', 'APPROVED', 'REJECTED')),
  document_notes text,
  service_approvals jsonb,
  approval_notes text,
  is_online boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. Rider Dummy Verification Documents & Dummy Bank Structure (MVP non-sensitive placeholder references)
create table if not exists public.rider_documents (
  rider_id uuid primary key references public.profiles(id) on delete cascade,
  dummy_gov_id_ref text not null,
  dummy_license_ref text not null,
  dummy_vehicle_plate text not null,
  dummy_vehicle_type text not null,
  dummy_payout_ref text not null,
  dummy_bank_details jsonb,
  submitted_at timestamptz not null default now()
);

-- 3. Restaurants
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cuisine text not null,
  address text not null,
  prep_time_mins integer not null default 25,
  rating numeric(2,1) not null default 4.5,
  image_url text not null,
  is_open boolean not null default true,
  supports_delivery boolean not null default true,
  supports_self_pickup boolean not null default true,
  created_at timestamptz not null default now()
);

-- 4. Menu Items
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text not null,
  category text not null,
  price numeric(10,2) not null check (price >= 0),
  is_veg boolean not null default true,
  is_available boolean not null default true
);

-- 5. Pricing Settings (Singleton configuration managed by Owner)
create table if not exists public.pricing_settings (
  id integer primary key default 1 check (id = 1),
  base_delivery_fee numeric(10,2) not null default 29,
  free_delivery_threshold numeric(10,2) not null default 399,
  platform_fee numeric(10,2) not null default 6,
  self_pickup_fee numeric(10,2) not null default 0,
  rider_commission_percent integer not null default 80 check (rider_commission_percent between 10 and 100),
  updated_at timestamptz not null default now()
);

-- 6. Orders (FOOD_DELIVERY and SELF_PICKUP only in MVP)
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.profiles(id),
  restaurant_id uuid not null references public.restaurants(id),
  service_type text not null check (service_type in ('FOOD_DELIVERY', 'SELF_PICKUP')),
  subtotal numeric(10,2) not null,
  delivery_fee numeric(10,2) not null,
  platform_fee numeric(10,2) not null,
  total_amount numeric(10,2) not null,
  rider_fee numeric(10,2) not null default 0,
  delivery_address text,
  pickup_instructions text,
  payment_method text not null check (payment_method in ('CASH_ON_DELIVERY', 'PAY_AT_COUNTER')),
  payment_status text not null default 'PENDING_COLLECTION',
  status text not null default 'PLACED',
  assigned_rider_id uuid references public.profiles(id),
  rider_job_status text not null default 'UNASSIGNED',
  milestones jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. Order Items
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  name text not null,
  price numeric(10,2) not null,
  quantity integer not null check (quantity > 0),
  is_veg boolean not null default true
);

-- 8. Rider Earnings Ledger (Never auto-approved; settled only via manual_payouts)
create table if not exists public.rider_earnings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null,
  payout_status text not null default 'UNPAID_PENDING_MANUAL_REVIEW'
    check (payout_status in ('UNPAID_PENDING_MANUAL_REVIEW', 'SETTLED_MANUALLY')),
  manual_payout_id uuid,
  completed_at timestamptz not null default now()
);

-- 9. Manual Payout Records (Created exclusively by Owner / Super Admin)
create table if not exists public.manual_payouts (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null check (amount > 0),
  reference_number text not null,
  method_note text not null,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now()
);

-- 10. Immutable Audit Logs
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz not null default now(),
  actor_id text not null,
  actor_role text not null,
  actor_email text not null,
  action text not null,
  target text not null,
  details text not null
);

-- 11. Rider Approval History (Separate document & service decision history)
create table if not exists public.rider_approval_history (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  target text not null check (target in ('DOCUMENTS', 'SERVICE_FOOD_DELIVERY', 'REGISTRATION')),
  service_key text check (service_key in ('FOOD_DELIVERY', 'GROCERY', 'PARCEL', 'BIKE_TAXI')),
  previous_status text,
  new_status text not null check (new_status in ('PENDING', 'APPROVED', 'REJECTED')),
  reason text not null,
  actor_id text not null,
  actor_role text not null,
  actor_email text not null,
  timestamp timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;
alter table public.rider_documents enable row level security;
alter table public.restaurants enable row level security;
alter table public.menu_items enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.rider_earnings enable row level security;
alter table public.manual_payouts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rider_approval_history enable row level security;

-- Helper function to inspect current user role safely
create or replace function public.current_user_role()
returns text language sql stable security definer as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Basic RLS Policies
create policy "Public read restaurants" on public.restaurants for select using (true);
create policy "Public read menu items" on public.menu_items for select using (true);
create policy "Public read pricing" on public.pricing_settings for select using (true);

create policy "Users view own profile or owner views all" on public.profiles
  for select using (id = auth.uid() or public.current_user_role() = 'OWNER');

-- Block public Owner registration via RLS
create policy "Customers and riders can insert own non-owner profile" on public.profiles
  for insert with check (id = auth.uid() and role in ('CUSTOMER', 'RIDER'));

create policy "Customers view own orders; riders view assigned; owners view all" on public.orders
  for select using (
    customer_id = auth.uid()
    or assigned_rider_id = auth.uid()
    or public.current_user_role() = 'OWNER'
  );
