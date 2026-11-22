-- Yup! 369 — Storage RLS Policies for Private Rider KYC Bucket (rider-kyc-docs)
-- Derived from verified: supabase/schema.sql
--
-- EXECUTION ORDER:
--   * RUN ONLY AFTER supabase/STAGING_SETUP.sql has completed successfully.
--   * Requires public.current_profile_id(), public.current_user_role(), and the
--     'rider-kyc-docs' bucket to already exist.
--   * NOTE: On hosted Supabase projects, storage.objects is owned by supabase_storage_admin.
--     If running this file in the SQL Editor raises "must be owner of table objects",
--     configure these exact two policies in Supabase Dashboard -> Storage -> Policies
--     (bucket: rider-kyc-docs) or execute with storage-admin privileges.

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
