-- Soundboard schema
-- Run this in the Supabase SQL editor (or via `supabase db push` if you're using the CLI).

-- ============================================================
-- PROFILES
-- One row per authenticated user, linking Supabase auth to a role.
-- 'owner' = you (and any techs/assistants you add later)
-- 'client' = a client with portal access
-- ============================================================
create type user_role as enum ('owner', 'client');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'client',
  full_name text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Helper: is the current user an owner/tech? Defined here, immediately
-- after profiles, because every other table's RLS policies below call it —
-- it has to exist before anything references it, or running this script
-- top-to-bottom fails partway through with "function is_owner() does not
-- exist" (which is exactly what happens if this definition sits later in
-- the file, as an earlier version of this schema mistakenly did).
-- search_path is pinned so this can't be tricked by a session-level
-- search_path change into resolving `profiles` from an unexpected schema.
create or replace function is_owner()
returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'owner'
  );
$$;

-- Auto-create a profiles row whenever someone signs up, always as 'client'.
-- There is deliberately no INSERT policy on profiles for regular users —
-- this trigger (security definer, so it can write despite RLS) is the only
-- way a row gets created, which means role can never be set to 'owner' by
-- anything a client controls. To make yourself (or a tech) an owner, run
-- this manually in the SQL editor after they've signed up once:
--   update profiles set role = 'owner' where id = '<their auth.users id>';
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, role) values (new.id, 'client');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- profiles: users can read their own profile; owners can read all
create policy "profiles_self_or_owner_select" on profiles
  for select using (id = auth.uid() or is_owner());

-- ============================================================
-- CLIENTS
-- The canonical client record — this is your "second brain."
-- client_user_id is nullable: many of your 800 clients won't have
-- logged in yet, so they can exist here before they have an account.
-- ============================================================
create table clients (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  address text,
  zip text,
  lat double precision,
  lng double precision,
  active boolean not null default true,
  email_opt_out boolean not null default false,
  last_reminder_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index on clients (client_user_id);

-- ============================================================
-- LOCATION TYPE
-- Tuning happens in the client's home. Bigger work — rebuilds, major
-- repairs, anything needing the bench and shop tools — happens at the
-- shop instead. This distinction has to be enforced at booking time,
-- not just suggested in the UI, or a client could self-schedule shop-only
-- work into a home-visit slot. See book_slot() below.
-- ============================================================
create type location_type as enum ('in_home', 'in_shop');

-- ============================================================
-- SERVICE CATALOG
-- Standard tasks organized by category (rebuilding, regulation, repair,
-- voicing, tuning), pulled from PTG-standard terminology (grand
-- regulation sequence: let-off/drop/key dip/aftertouch/backcheck/
-- repetition spring; standard voicing technique: filing/needling/
-- hardening; common repair categories) rather than invented generically.
-- No price is seeded — pricing varies too much by region/technician to
-- guess at, and guessing wrong would be worse than leaving it blank for
-- you to fill in per estimate. This is deliberately a starting set, not
-- exhaustive — add, edit, or remove rows here as your own practice
-- differs from the general standard.
-- ============================================================
create table service_catalog (
  id uuid primary key default gen_random_uuid(),
  category text not null, -- see the many categories seeded below (actions_general, dampers,
                            -- hammers, wippens, etc.) plus rebuilding/voicing/tuning for the
                            -- broader workflow-phase and hourly-rate items
  name text not null,
  default_location_type location_type not null default 'in_home',
  default_requires_client_visit boolean not null default true,
  default_depends_on_previous boolean not null default false,
  typical_duration_days int, -- rough guide for shop-only phases, not enforced
  sort_order int not null default 0,
  active boolean not null default true
);
create index on service_catalog (category, sort_order);

-- Price lives here, one row per piano type this task has a distinct price
-- for — not as a single column on service_catalog. This is the actual fix
-- for "same job, different instrument": the task is one stable thing: the
-- price varies by piano type and stays consistent within that type, rather
-- than every estimate re-deciding both from scratch.
create table service_catalog_prices (
  id uuid primary key default gen_random_uuid(),
  service_catalog_id uuid not null references service_catalog(id) on delete cascade,
  piano_type text not null, -- 'grand' | 'upright' | 'drop_action' | 'square_grand' | 'birdcage' | 'digital'
  price numeric(10,2) not null,
  unique (service_catalog_id, piano_type)
);
create index on service_catalog_prices (service_catalog_id);

alter table service_catalog enable row level security;

-- Owner-only reference data — clients never need to see the price list.
create policy "service_catalog_owner_full_access" on service_catalog
  for all using (is_owner()) with check (is_owner());
-- Read access for any authenticated session, since the catalog itself
-- carries no client-identifying or pricing-sensitive information beyond
-- task names — but writes stay owner-only above. (In practice only the
-- owner's UI ever queries this table today; this just avoids being more
-- restrictive than necessary if that changes.)
create policy "service_catalog_authenticated_select" on service_catalog
  for select using (auth.uid() is not null);

alter table service_catalog_prices enable row level security;

create policy "service_catalog_prices_owner_full_access" on service_catalog_prices
  for all using (is_owner()) with check (is_owner());
create policy "service_catalog_prices_authenticated_select" on service_catalog_prices
  for select using (auth.uid() is not null);

insert into service_catalog (category, name, default_location_type, default_requires_client_visit, default_depends_on_previous, typical_duration_days, sort_order) values
  -- REBUILDING — a full rebuild's typical sequence, shop work with
  -- dependencies chained (each phase generally can't start before the
  -- last), bookended by two client visits (evaluation, then delivery).
  ('rebuilding', 'Rebuild evaluation & proposal', 'in_home', true, false, null, 10),
  ('rebuilding', 'Pickup / transport to shop', 'in_home', true, true, null, 20),
  ('rebuilding', 'Full disassembly & inspection', 'in_shop', false, true, 2, 30),
  ('rebuilding', 'Soundboard repair or replacement', 'in_shop', false, true, 7, 40),
  ('rebuilding', 'Bridge recapping / bridge repair', 'in_shop', false, true, 3, 50),
  ('rebuilding', 'Pinblock replacement', 'in_shop', false, true, 3, 60),
  ('rebuilding', 'Full restringing', 'in_shop', false, true, 3, 70),
  ('rebuilding', 'Action rebuild (hammers, shanks, flanges, bridle straps)', 'in_shop', false, true, 5, 80),
  ('rebuilding', 'Key recovering & key bushing replacement', 'in_shop', false, true, 3, 90),
  ('rebuilding', 'Damper replacement / refelting', 'in_shop', false, true, 2, 100),
  ('rebuilding', 'Case refinishing', 'in_shop', false, true, 10, 110),
  ('rebuilding', 'Reassembly & initial regulation', 'in_shop', false, true, 3, 120),
  ('rebuilding', 'Pitch raise & shop tuning', 'in_shop', false, true, 1, 130),
  ('rebuilding', 'Delivery, final tuning & voicing', 'in_home', true, true, null, 140),

  -- VOICING — the real price list punts this to "hourly rates apply" with
  -- no fixed numbers, so this structured breakdown still adds real value.
  ('voicing', 'Tone evaluation', 'in_home', true, false, null, 10),
  ('voicing', 'Hammer filing & reshaping', 'in_home', true, false, null, 20),
  ('voicing', 'Needle voicing (softening)', 'in_home', true, true, null, 30),
  ('voicing', 'Hardening treatment (lacquer/chemical)', 'in_home', true, false, null, 40),
  ('voicing', 'String leveling for unison strike', 'in_home', true, false, null, 50),
  ('voicing', 'Final voicing pass after tuning', 'in_home', true, true, null, 60);

-- ============================================================
-- REAL PRICE LIST — Edens Piano Service's own numbers, derived from the
-- "G" Piano Works Repair Labor Guide's mean labor hours per task. 275
-- tasks across 16 categories (actions, bridle straps, butts & flanges,
-- dampers, felt/leather, hammers, keys/keybed/keyframe, knuckles, lyres/
-- pedals/trapwork, miscellaneous, regulation, soundboards/bridges/plates,
-- springs, strings & tuning pins, tuning, wippens), each priced per piano
-- type where the source data gives a distinct price (not every task
-- applies to every type — a birdcage-specific repair has no "square
-- grand" price, for instance, and that's correctly just absent below
-- rather than guessed at).
--
-- IMPORTANT — these are ~10-year-old numbers, priced under market at the
-- time. Loaded here exactly as transcribed from the source spreadsheet,
-- not adjusted: guessing at a markup percentage is a business decision,
-- not something to bake into a data migration. Use the bulk price
-- adjustment tool on /owner/services to bring these up to current market
-- rates before relying on them for real estimates.
--
-- One data point worth a second look before you rely on it: "Keytops,
-- ivory: Replace/reglue, head or tail, set" prices at $5,800 (grand) /
-- $6,526 (square grand) — dramatically higher than the sibling "each"
-- row at $73.50, and worth confirming against the original guide in case
-- of a transcription slip somewhere upstream of this file.
-- ============================================================

-- Real pricing data from Edens Piano Service's own price list (derived from
-- the "G" Piano Works Repair Labor Guide's mean labor hours) -- 275 tasks
-- across 16 categories, each priced per piano type where the guide gives a
-- distinct price. Loaded from the owner's own spreadsheet, not invented.
insert into service_catalog (category, name, default_location_type, default_requires_client_visit, default_depends_on_previous, sort_order) values
  ('actions_general', 'Action bracket anchor bolts:  Replace (upper or lower), set', 'in_home', true, false, 10),
  ('actions_general', 'Action brackets: Replace, each (Includes alignment and partial regulation)', 'in_home', true, false, 20),
  ('actions_general', 'Action brackets: Weld, each (Includes alignment and necessary regulation)', 'in_home', true, false, 30),
  ('actions_general', 'Clean, Tighten and Lubricate/ ease', 'in_home', true, false, 40),
  ('actions_general', 'Remove and Replace', 'in_home', true, false, 50),
  ('actions_general', 'Tighten all action screws', 'in_home', true, false, 60),
  ('actions_general', 'Player action & Mechanism (treadle- type) : Remove and replace', 'in_home', true, false, 70),
  ('actions_general', 'Player action & Mechanism (reproducer- type) : Remove and replace', 'in_home', true, false, 80),
  ('bridle_straps', 'Replace: cork or clip type, each', 'in_home', true, false, 10),
  ('bridle_straps', 'Replace: cork or clip tye, set', 'in_home', true, false, 20),
  ('bridle_straps', 'Replace: standard type, each', 'in_home', true, false, 30),
  ('bridle_straps', 'Replace: standard type, set', 'in_home', true, false, 40),
  ('butts_flanges', 'Backcatch: Repalce, each', 'in_home', true, false, 10),
  ('butts_flanges', 'Backcatch: Repalce, set', 'in_home', true, false, 20),
  ('butts_flanges', 'Backcatch shank: Replace, each', 'in_home', true, false, 30),
  ('butts_flanges', 'Backcatch shank: Replace, set', 'in_home', true, false, 40),
  ('butts_flanges', 'Backcatch buckskin: Replace, each', 'in_home', true, false, 50),
  ('butts_flanges', 'Backcatch buckskin: Replace, set', 'in_home', true, false, 60),
  ('butts_flanges', 'Billings Flange: Replace, each', 'in_home', true, false, 70),
  ('butts_flanges', 'Billings Flange: Replace, set', 'in_home', true, false, 80),
  ('butts_flanges', 'Brass Plate: Replace, each', 'in_home', true, false, 90),
  ('butts_flanges', 'Brass Plate: Replace, set', 'in_home', true, false, 100),
  ('butts_flanges', 'Brass Rail: Replace, exact copy', 'in_home', true, false, 110),
  ('butts_flanges', 'Brass Rail: Modify to use European- style flanges', 'in_home', true, false, 120),
  ('butts_flanges', 'Butt and Flange, new: Replace, each', 'in_home', true, false, 130),
  ('butts_flanges', 'Butt and Flange, new: Replace, set', 'in_home', true, false, 140),
  ('butts_flanges', 'Butt Felt: Replace, each', 'in_home', true, false, 150),
  ('butts_flanges', 'Butt Felt: Replace, set', 'in_home', true, false, 160),
  ('butts_flanges', 'Butt leather w/ underfelt: Replace, each', 'in_home', true, false, 170),
  ('butts_flanges', 'Butt leather w/ underfelt: Replace, set', 'in_home', true, false, 180),
  ('butts_flanges', 'Flange: Repin, each', 'in_home', true, false, 190),
  ('butts_flanges', 'Flange: Repin, set', 'in_home', true, false, 200),
  ('butts_flanges', 'Flange: Replace, each', 'in_home', true, false, 210),
  ('butts_flanges', 'Flange: Replace, set', 'in_home', true, false, 220),
  ('butts_flanges', 'Flange: Rebush (both sides), each', 'in_home', true, false, 230),
  ('dampers', 'Damper Felt: Replace, each', 'in_home', true, false, 10),
  ('dampers', 'Damper Felt: Replace, set', 'in_home', true, false, 20),
  ('dampers', 'Damper flange: Replace, each', 'in_home', true, false, 30),
  ('dampers', 'Damper flange: Replace, set', 'in_home', true, false, 40),
  ('dampers', 'Damper lever assembly: Replace, each', 'in_home', true, false, 50),
  ('dampers', 'Damper lever assembly: Replace, set (includes alignment and regulation)', 'in_home', true, false, 60),
  ('dampers', 'Damper lever flange: Repin or replace, each', 'in_home', true, false, 70),
  ('dampers', 'Damper lift rod: Clean & lubricate', 'in_home', true, false, 80),
  ('dampers', 'Damper lift rod/tray pivots: Replace/repair', 'in_home', true, false, 90),
  ('dampers', 'Damper lift felt: Replace, each', 'in_home', true, false, 100),
  ('dampers', 'Damper lift felt: Replace, set', 'in_home', true, false, 110),
  ('dampers', 'Damper spring groove: Teflon, remove/replace with new punching, each', 'in_home', true, false, 120),
  ('dampers', 'Damper spring groove: Teflon, remove/replace with new punching, set', 'in_home', true, false, 130),
  ('dampers', 'Damper spring punching: Replace, each', 'in_home', true, false, 140),
  ('dampers', 'Damper spring punching: Replace, set', 'in_home', true, false, 150),
  ('dampers', 'Damper top flange: Replace, each', 'in_home', true, false, 160),
  ('dampers', 'Damper top flange: Replace, set', 'in_home', true, false, 170),
  ('dampers', 'Damper wood block w/new felt: Replace, each', 'in_home', true, false, 180),
  ('dampers', 'Damper wood block w/new felt: Replace, set', 'in_home', true, false, 190),
  ('dampers', 'Grand damper guide rail bushing: Ease, each', 'in_home', true, false, 200),
  ('dampers', 'Grand damper guide rail bushing: Replace, each', 'in_home', true, false, 210),
  ('dampers', 'Grand damper guide rail bushing: Replace, set', 'in_home', true, false, 220),
  ('dampers', 'Grand damper guide rail:Reapair, set', 'in_home', true, false, 230),
  ('dampers', 'Grand damper guide rail: Repair, refurbish & refelt', 'in_home', true, false, 240),
  ('dampers', 'Grand damper tray: Remove, rebuild, install', 'in_home', true, false, 250),
  ('dampers', 'Underlever flange screws: Tighten, set', 'in_home', true, false, 260),
  ('felt_leather', 'Butt spring punching: Replace, each', 'in_home', true, false, 10),
  ('felt_leather', 'Butt spring punching: Replace, set', 'in_home', true, false, 20),
  ('felt_leather', 'Grand action sfhift rebound felt: Replace', 'in_home', true, false, 30),
  ('felt_leather', 'Grand action shift rebound felt (on repetition lever): each', 'in_home', true, false, 40),
  ('felt_leather', 'Grand jack button punching: Each', 'in_home', true, false, 50),
  ('felt_leather', 'Grand jack button punching: set', 'in_home', true, false, 60),
  ('felt_leather', 'Grand key upstop rail felt: Replace', 'in_home', true, false, 70),
  ('felt_leather', 'Grand repetition lever cloth (or leather): Each', 'in_home', true, false, 80),
  ('felt_leather', 'Grand repetition lever cloth (or leather): set', 'in_home', true, false, 90),
  ('felt_leather', 'Grand repetition stop button punching: Each', 'in_home', true, false, 100),
  ('felt_leather', 'Grand repetition stop button punching: set', 'in_home', true, false, 110),
  ('felt_leather', 'Hammer rail pivot bushing: Replace, each', 'in_home', true, false, 120),
  ('felt_leather', 'Hammer rest rail felt: Replace', 'in_home', true, false, 130),
  ('felt_leather', 'Let off punching, replace: Each', 'in_home', true, false, 140),
  ('felt_leather', 'Let off punching, replace: Set', 'in_home', true, false, 150),
  ('felt_leather', 'Muffler felt: Replace, strip', 'in_home', true, false, 160),
  ('felt_leather', 'Nameboard felt: Replace', 'in_home', true, false, 170),
  ('felt_leather', 'Spring rail felt: Replace', 'in_home', true, false, 180),
  ('felt_leather', 'Sticker felt: Replace, set', 'in_home', true, false, 190),
  ('hammers', 'Boring: Each', 'in_home', true, false, 10),
  ('hammers', 'Boring: Set', 'in_home', true, false, 20),
  ('hammers', '"Buckskinning" hammer surface: Each', 'in_home', true, false, 30),
  ('hammers', 'Hammer flange rail sandpaper: Replace', 'in_home', true, false, 40),
  ('hammers', 'Loose hammers: Reglue, first', 'in_home', true, false, 50),
  ('hammers', 'Loose Hammers: Reglue, after first', 'in_home', true, false, 60),
  ('hammers', 'Loose hammers: Reglue, set', 'in_home', true, false, 70),
  ('hammers', 'Loose hammers: Reglue w/hide glue & water, set', 'in_home', true, false, 80),
  ('hammers', 'New hammer: Install, each', 'in_home', true, false, 90),
  ('hammers', 'New hammers: Install, set', 'in_home', true, false, 100),
  ('hammers', 'New hammers: Install w/ shanks and butts', 'in_home', true, false, 110),
  ('hammers', 'New hammers: Install w/ shanks and flanges', 'in_home', true, false, 120),
  ('hammers', 'New hammers: Install w/ new shanks ONLY', 'in_home', true, false, 130),
  ('hammers', 'Replace hammers (with used or new/old stock): When plug and redrill is required, each', 'in_home', true, false, 140),
  ('hammers', 'Hammershank: Replace, each', 'in_home', true, false, 150),
  ('hammers', 'Hammershank: replace, set', 'in_home', true, false, 160),
  ('hammers', 'Shank sleeves: Metal type (not recommended), each', 'in_home', true, false, 170),
  ('hammers', 'Surfacing ("reshaping"): Set', 'in_home', true, false, 180),
  ('hammers', 'Traveling: Shank, each', 'in_home', true, false, 190),
  ('hammers', 'Traveling: Shank, set', 'in_home', true, false, 200),
  ('keys_keybed_keyframe', 'Acrylic repair (of ivory): Each', 'in_home', true, false, 10),
  ('keys_keybed_keyframe', 'Capstans: Buff, set', 'in_home', true, false, 20),
  ('keys_keybed_keyframe', 'Capstans: Coat w/Emralon, (after buffing), set', 'in_home', true, false, 30),
  ('keys_keybed_keyframe', 'Grand backcheck block and/or felt: Replace, each', 'in_home', true, false, 40),
  ('keys_keybed_keyframe', 'Grand backcheck block and/or felt: Replace, set', 'in_home', true, false, 50),
  ('keys_keybed_keyframe', 'Grand backcheck felt and/or leather: Resurface, set', 'in_home', true, false, 60),
  ('keys_keybed_keyframe', 'Grand backcheck wire: Replace, each', 'in_home', true, false, 70),
  ('keys_keybed_keyframe', 'Key button: Replace, each', 'in_home', true, false, 80),
  ('keys_keybed_keyframe', 'Key button: Replace, set', 'in_home', true, false, 90),
  ('keys_keybed_keyframe', 'Keyframe: Bed to keybed', 'in_home', true, false, 100),
  ('keys_keybed_keyframe', 'Keyframe: Refelt, single rail ONLY', 'in_home', true, false, 110),
  ('keys_keybed_keyframe', 'Keyframe: Refelt, front, center & back rail', 'in_home', true, false, 120),
  ('keys_keybed_keyframe', 'Keyframe: Refelt, complete', 'in_home', true, false, 130),
  ('keys_keybed_keyframe', 'Keys: Ease bushings (both rails) set', 'in_home', true, false, 140),
  ('keys_keybed_keyframe', 'Keys: Replace bushing (front or balance), each', 'in_home', true, false, 150),
  ('keys_keybed_keyframe', 'Keys: Replace bushings (1 rail only), set', 'in_home', true, false, 160),
  ('keys_keybed_keyframe', 'Keys: replace bushings (both rails) set', 'in_home', true, false, 170),
  ('keys_keybed_keyframe', 'Key pin: Polish, (both rails) set', 'in_home', true, false, 180),
  ('keys_keybed_keyframe', 'Key pin: Replace, each', 'in_home', true, false, 190),
  ('keys_keybed_keyframe', 'Key pin: Replace, set, one rail', 'in_home', true, false, 200),
  ('keys_keybed_keyframe', 'Key pin: Replace, set, both rails', 'in_home', true, false, 210),
  ('keys_keybed_keyframe', 'Keys: Balance & weight, set', 'in_home', true, false, 220),
  ('keys_keybed_keyframe', 'Keys: Balance & weight w/jiffy leads, set (NOT RECOMMENDED)', 'in_home', true, false, 230),
  ('keys_keybed_keyframe', 'Keys: Level & set dip after replacing tops, set', 'in_home', true, false, 240),
  ('keys_keybed_keyframe', 'Keyfronts: Replace, plastic, each', 'in_home', true, false, 250),
  ('keys_keybed_keyframe', 'Keyfronts: Replace, plastic, set', 'in_home', true, false, 260),
  ('keys_keybed_keyframe', 'Keytops, ivory: Clean, sand & buff set', 'in_home', true, false, 270),
  ('keys_keybed_keyframe', 'Keytops, ivory: Replace/reglue, head or tail, each', 'in_home', true, false, 280),
  ('keys_keybed_keyframe', 'Keytops, ivory: Replace/reglue, head or tail, set', 'in_home', true, false, 290),
  ('keys_keybed_keyframe', 'Keytops, ivory: "Waterfall" (remove lip), set', 'in_home', true, false, 300),
  ('keys_keybed_keyframe', 'Keytops, plastic: Clean, sand & buff set', 'in_home', true, false, 310),
  ('keys_keybed_keyframe', 'Keytops, Clean sharps, set', 'in_home', true, false, 320),
  ('keys_keybed_keyframe', 'Keytops: Clean sides & "re-black" sharps, (stick only)', 'in_home', true, false, 330),
  ('keys_keybed_keyframe', 'Keytops plastic: Replace, each', 'in_home', true, false, 340),
  ('keys_keybed_keyframe', 'Keytops, plastic: Replace, set', 'in_home', true, false, 350),
  ('keys_keybed_keyframe', 'Sharps, ebony: Paint, set (NOT RECOMMENDED)', 'in_home', true, false, 360),
  ('keys_keybed_keyframe', 'Sharps, ebony: Replace, each', 'in_home', true, false, 370),
  ('keys_keybed_keyframe', 'Sharps, ebony: Replace,set', 'in_home', true, false, 380),
  ('keys_keybed_keyframe', 'Sharps, plastic: Replace, each', 'in_home', true, false, 390),
  ('keys_keybed_keyframe', 'Sharps, plastic: Replace, set', 'in_home', true, false, 400),
  ('keys_keybed_keyframe', 'Keystick: Laminate top, surface, set', 'in_home', true, false, 410),
  ('knuckles', 'Knuckle:  Bolster/file/lubricate, etc., set', 'in_home', true, false, 10),
  ('knuckles', 'Knuckle:  Refelt & Replace buckskin, each', 'in_home', true, false, 20),
  ('knuckles', 'Knuckle:  Refelt & Replace buckskin, set', 'in_home', true, false, 30),
  ('knuckles', 'Knuckle:  Replace, each', 'in_home', true, false, 40),
  ('knuckles', 'Knuckle:  Replace, set', 'in_home', true, false, 50),
  ('lyres_pedals_trapwork', 'Damper pitman rod, wood:  Replace, each', 'in_home', true, false, 10),
  ('lyres_pedals_trapwork', 'Damper pitman rod, brass:  Replace, each', 'in_home', true, false, 20),
  ('lyres_pedals_trapwork', 'Lyre braces:  Replac, set', 'in_home', true, false, 30),
  ('lyres_pedals_trapwork', 'Lyre pedal rods:  Replace, set', 'in_home', true, false, 40),
  ('lyres_pedals_trapwork', 'Lyre:  General recondition/ rebuild', 'in_home', true, false, 50),
  ('lyres_pedals_trapwork', 'Pedal pins:  Replace, each', 'in_home', true, false, 60),
  ('lyres_pedals_trapwork', 'Pedal pivots:  Rebush & lube, set', 'in_home', true, false, 70),
  ('lyres_pedals_trapwork', 'Pedal rods guide bushing:  Replace, each', 'in_home', true, false, 80),
  ('lyres_pedals_trapwork', 'Pedal rods guide bushing:  Replace, set', 'in_home', true, false, 90),
  ('lyres_pedals_trapwork', 'Pedal rods:  replace, each', 'in_home', true, false, 100),
  ('lyres_pedals_trapwork', 'Pedal spring:  Replace, each', 'in_home', true, false, 110),
  ('lyres_pedals_trapwork', 'Pedals:  Replace, set', 'in_home', true, false, 120),
  ('lyres_pedals_trapwork', 'Sostenuto monkey:  Replace, each', 'in_home', true, false, 130),
  ('lyres_pedals_trapwork', 'Trapwork:  Reconditioning/ repair', 'in_home', true, false, 140),
  ('regulation', 'Action: Partial regulation', 'in_home', true, false, 10),
  ('regulation', 'Action:  Major regulation: Complete', 'in_home', true, false, 20),
  ('regulation', 'Damers:  Partial regulation, set', 'in_home', true, false, 30),
  ('regulation', 'Dampers:  Major regulation (from scatch)', 'in_home', true, false, 40),
  ('soundboards_bridges_plates', 'Bridge:  Bass, curved type, recap', 'in_home', true, false, 10),
  ('soundboards_bridges_plates', 'Bridge:  Bass, curved type, replace', 'in_home', true, false, 20),
  ('soundboards_bridges_plates', 'Bridge:  Bass, straight type, recap', 'in_home', true, false, 30),
  ('soundboards_bridges_plates', 'Bridge:  Bass, straight type, replace', 'in_home', true, false, 40),
  ('soundboards_bridges_plates', 'Bridge:  Reglue old', 'in_home', true, false, 50),
  ('soundboards_bridges_plates', 'Bridge:  Repair, epoxy, major cracks', 'in_home', true, false, 60),
  ('soundboards_bridges_plates', 'Bridge:  Repair, epoxy, minor cracks', 'in_home', true, false, 70),
  ('soundboards_bridges_plates', 'Bridge:  Treble, recap, per unison', 'in_home', true, false, 80),
  ('soundboards_bridges_plates', 'Bridge:  Treble, recap entire bridge', 'in_home', true, false, 90),
  ('soundboards_bridges_plates', 'Bridge:  Treble, replace, per unison', 'in_home', true, false, 100),
  ('soundboards_bridges_plates', 'Bridge:  Treble, replace, entire bridge', 'in_home', true, false, 110),
  ('soundboards_bridges_plates', 'Plate:  Rebronze', 'in_home', true, false, 120),
  ('soundboards_bridges_plates', 'Plate:  Removal', 'in_home', true, false, 130),
  ('soundboards_bridges_plates', 'Plate:  Clean', 'in_home', true, false, 140),
  ('soundboards_bridges_plates', 'Plate:  Clear & clear coat w/ laquer', 'in_home', true, false, 150),
  ('soundboards_bridges_plates', 'Plate:  Installation', 'in_home', true, false, 160),
  ('soundboards_bridges_plates', 'Plate:  Weld (NOT GUARANTEED, AND WILL BE CONTRACTED OUT.)', 'in_home', true, false, 170),
  ('soundboards_bridges_plates', 'Ribs:  Re-attach to soundboard, each', 'in_home', true, false, 180),
  ('soundboards_bridges_plates', 'Soundboard:  Refinish, lacquer', 'in_home', true, false, 190),
  ('soundboards_bridges_plates', 'Soundboard:  Refinish, olde method, varnish', 'in_home', true, false, 200),
  ('soundboards_bridges_plates', 'Soundboard:  Replace, w/ old bridges (5''-7'')', 'in_home', true, false, 210),
  ('soundboards_bridges_plates', 'Soundboard:  Replace, w/ old bridges (7''-9'')', 'in_home', true, false, 220),
  ('soundboards_bridges_plates', 'Soundboard:  Replace, w/ new bridges (5''-7'')', 'in_home', true, false, 230),
  ('soundboards_bridges_plates', 'Soundboard:  Replace, w/ new bridges (7''-9'')', 'in_home', true, false, 240),
  ('soundboards_bridges_plates', 'Soundboard buttons:  Replace, each', 'in_home', true, false, 250),
  ('soundboards_bridges_plates', 'Soundboard shimming: Per foot', 'in_home', true, false, 260),
  ('springs_action', 'Damper spring:  Replace, each', 'in_home', true, false, 10),
  ('springs_action', 'Damper sping:  Replace, set', 'in_home', true, false, 20),
  ('springs_action', 'Hammer spring:  Replace, each', 'in_home', true, false, 30),
  ('springs_action', 'Hammer spring:  Replace, set', 'in_home', true, false, 40),
  ('springs_action', 'Jack spring:  Replace, each', 'in_home', true, false, 50),
  ('springs_action', 'Jack spring:  Replace, set', 'in_home', true, false, 60),
  ('springs_action', 'Jack spring cord:  Replace, first', 'in_home', true, false, 70),
  ('springs_action', 'Jack spring cord:  Replace, each after first', 'in_home', true, false, 80),
  ('springs_action', 'Jack spring cord:  Replace, set', 'in_home', true, false, 90),
  ('springs_action', 'Repetition lever spring:  Replace, each', 'in_home', true, false, 100),
  ('springs_action', 'Repetition lever spring:  Replace, set', 'in_home', true, false, 110),
  ('strings_tuning_pins', 'Agraffe:  Replace, each', 'in_home', true, false, 10),
  ('strings_tuning_pins', 'Bass strings: Custom or Universal, first, each', 'in_home', true, false, 20),
  ('strings_tuning_pins', 'Bass strings:  Custom or Universal, after first, each', 'in_home', true, false, 30),
  ('strings_tuning_pins', 'Bass strings:  Liven roll, twist & tune, each', 'in_home', true, false, 40),
  ('strings_tuning_pins', 'Bass strings:  Liven roll, twist & tune, set', 'in_home', true, false, 50),
  ('strings_tuning_pins', 'Bass strings:  New, set (does not include new tuning pins)', 'in_home', true, false, 60),
  ('strings_tuning_pins', 'Bass strings:  New, , 7''-9'' grands.', 'in_home', true, false, 70),
  ('strings_tuning_pins', 'Bass strings:  New, set (includes new tuning pins, two tunings in home)', 'in_home', true, false, 80),
  ('strings_tuning_pins', 'Bass strings:  New, set, 7''-9'' grands', 'in_home', true, false, 90),
  ('strings_tuning_pins', 'Pinblock restorer:  Apply, (no tuning)', 'in_home', true, false, 100),
  ('strings_tuning_pins', 'Pinblock:  Replace', 'in_home', true, false, 110),
  ('strings_tuning_pins', 'Restring:  Complete (Except 7''-9'' grands and square grands.  Includes new tuning pins, string braid, etc., and one home tuning within 30 days of delivery.)', 'in_home', true, false, 120),
  ('strings_tuning_pins', 'Restring:  Complete  (7''-9'' grands and quare grands, same as above.)', 'in_home', true, false, 130),
  ('strings_tuning_pins', 'Strings:  Seating, set', 'in_home', true, false, 140),
  ('strings_tuning_pins', 'Strings:  Splice (tie), bass or treble, each', 'in_home', true, false, 150),
  ('strings_tuning_pins', 'String Scale: Data gathering', 'in_home', true, false, 160),
  ('strings_tuning_pins', 'String Scale: Evaluation: (calculation only.)', 'in_home', true, false, 170),
  ('strings_tuning_pins', 'Treble strings:  Replace, (NOT in over strung area), each', 'in_home', true, false, 180),
  ('strings_tuning_pins', 'Treble strings:  Repalce, (overstrung area), each', 'in_home', true, false, 190),
  ('strings_tuning_pins', 'Tuning pins:  Drive, NOT RECOMMENDED, set', 'in_home', true, false, 200),
  ('strings_tuning_pins', 'Tuning pins:  Oversized or shimmed, each', 'in_home', true, false, 210),
  ('strings_tuning_pins', 'Tuning pins:  Oversized, install, set (Includes one tuning)', 'in_home', true, false, 220),
  ('tuning', 'Tuning:  One or two times per year', 'in_home', true, false, 10),
  ('tuning', 'Raise or lower pitch:  5 to 25 cents', 'in_home', true, false, 20),
  ('tuning', 'Raise or lower pitch:  25 to 50 cents', 'in_home', true, false, 30),
  ('tuning', 'Raise or lower pitch:  More than 50 cents', 'in_home', true, false, 40),
  ('tuning', 'Concert tuning  (Includes minor regulation)', 'in_home', true, false, 50),
  ('tuning', 'Yamah CP series electronic piano (and similar)', 'in_home', true, false, 60),
  ('tuning', 'Fender Rhodes electronic piano (and similar)', 'in_home', true, false, 70),
  ('tuning', 'Reed Organs:  Per bank', 'in_home', true, false, 80),
  ('wippens', 'Backcheck block and/or felt/leather:  Replace,each', 'in_home', true, false, 10),
  ('wippens', 'Backcheck block and/or felt/leather:  Replace, set', 'in_home', true, false, 20),
  ('wippens', 'Backcheck block w/ wire attached:  Set', 'in_home', true, false, 30),
  ('wippens', 'Backcheckwire:  Replace, each', 'in_home', true, false, 40),
  ('wippens', 'Balancer spring retainer:  Replace, set', 'in_home', true, false, 50),
  ('wippens', 'Balancer spring retainer bushingL:  replace, set', 'in_home', true, false, 60),
  ('wippens', 'Bridle wire:  Replace, each', 'in_home', true, false, 70),
  ('wippens', 'Bridle wire:  Replace, set', 'in_home', true, false, 80),
  ('wippens', 'Cushion cloth (capstan contact felt):  Replace, each', 'in_home', true, false, 90),
  ('wippens', 'Cushion cloth (capstan contact felt):  Replace, set', 'in_home', true, false, 100),
  ('wippens', 'Elbow, plastic (snap-on type):  Replace, first', 'in_home', true, false, 110),
  ('wippens', 'Elbow, plastic (snap-on type):  Replace, each, after the first', 'in_home', true, false, 120),
  ('wippens', 'Elbow, plastic (snap- on type):  Set', 'in_home', true, false, 130),
  ('wippens', 'Elbow:  Replace with wood or plastic, first', 'in_home', true, false, 140),
  ('wippens', 'Elbow:  Replace with wood or plastic, after  first', 'in_home', true, false, 150),
  ('wippens', 'Elbow:  Replace with wood or plastic, set', 'in_home', true, false, 160),
  ('wippens', 'Jack:  Alignment in window, set', 'in_home', true, false, 170),
  ('wippens', 'Jack rebound felt:  Replace, each', 'in_home', true, false, 180),
  ('wippens', 'Jack rebound felt:  Repalce, set', 'in_home', true, false, 190),
  ('wippens', 'Jack:  Reglue (tongue or flange.), each', 'in_home', true, false, 200),
  ('wippens', 'Jack:  Reglue (tongue or flange.), set', 'in_home', true, false, 210),
  ('wippens', 'Jack:  Repin, each', 'in_home', true, false, 220),
  ('wippens', 'Jack:  Repin, set', 'in_home', true, false, 230),
  ('wippens', 'Jack:  Replace, each', 'in_home', true, false, 240),
  ('wippens', 'Jack:  Replace, set', 'in_home', true, false, 250),
  ('wippens', 'Lifters:  Rubber grommets, set (Add $72.50 for regulating lost motion, etc.)', 'in_home', true, false, 260),
  ('wippens', 'Lifters:  Plastics grommets w/ fiber nut, set (Add $72.5 for regulatimg lost motion, etc)', 'in_home', true, false, 270),
  ('wippens', 'Spoon:  Replace, each', 'in_home', true, false, 280),
  ('wippens', 'Spoon:  Replace, set', 'in_home', true, false, 290),
  ('wippens', 'Sticker:  Adjustable, replace, each', 'in_home', true, false, 300),
  ('wippens', 'Wippen:  Replace, each (Includes regulation)', 'in_home', true, false, 310),
  ('wippens', 'Wippen:  Replace, set (Does not Includes regulation)', 'in_home', true, false, 320),
  ('wippens', 'Wippen:  Rebuild w/ new felt, etc., set (Includes travel.)', 'in_home', true, false, 330),
  ('wippens', 'Wippen:  Travel, each', 'in_home', true, false, 340),
  ('wippens', 'Wippen:  Travel, set', 'in_home', true, false, 350),
  ('miscellaneous', 'Casters:  Replace, set', 'in_home', true, false, 10),
  ('miscellaneous', 'Cleaning of piano:  Complete, interior/exterior', 'in_home', true, false, 20),
  ('miscellaneous', '"Dampp-Chaser" installation:  Partial system', 'in_home', true, false, 30),
  ('miscellaneous', '"Dampp-Chaser" installation:  Complete system', 'in_home', true, false, 40),
  ('miscellaneous', 'Hinge pins:  Replace, each', 'in_home', true, false, 50),
  ('miscellaneous', 'Reed Organ:  Rebuild, Complete', 'in_home', true, false, 60),
  ('miscellaneous', 'Reed Organ:  Reconditioning', 'in_home', true, false, 70),
  ('miscellaneous', 'Vacumming and mothproofing', 'in_home', true, false, 80),
  ('miscellaneous', 'Vermin & insect eradication                      (Does not include moving expenses.)', 'in_home', true, false, 90);

insert into service_catalog_prices (service_catalog_id, piano_type, price) values
  ((select id from service_catalog where category = 'actions_general' and name = 'Action bracket anchor bolts:  Replace (upper or lower), set'), 'upright', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Action bracket anchor bolts:  Replace (upper or lower), set'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Action brackets: Replace, each (Includes alignment and partial regulation)'), 'grand', 937.5),
  ((select id from service_catalog where category = 'actions_general' and name = 'Action brackets: Weld, each (Includes alignment and necessary regulation)'), 'grand', 365.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Action brackets: Weld, each (Includes alignment and necessary regulation)'), 'upright', 365.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Action brackets: Weld, each (Includes alignment and necessary regulation)'), 'drop_action', 365.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Clean, Tighten and Lubricate/ ease'), 'grand', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Clean, Tighten and Lubricate/ ease'), 'upright', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Clean, Tighten and Lubricate/ ease'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Clean, Tighten and Lubricate/ ease'), 'square_grand', 125.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Clean, Tighten and Lubricate/ ease'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Remove and Replace'), 'grand', 55.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Remove and Replace'), 'upright', 35.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Remove and Replace'), 'drop_action', 70.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Remove and Replace'), 'square_grand', 55.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Remove and Replace'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Tighten all action screws'), 'grand', 35.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Tighten all action screws'), 'upright', 75.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Tighten all action screws'), 'drop_action', 75.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Tighten all action screws'), 'square_grand', 55.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Tighten all action screws'), 'birdcage', 95.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Player action & Mechanism (treadle- type) : Remove and replace'), 'grand', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Player action & Mechanism (treadle- type) : Remove and replace'), 'upright', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Player action & Mechanism (treadle- type) : Remove and replace'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Player action & Mechanism (treadle- type) : Remove and replace'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Player action & Mechanism (reproducer- type) : Remove and replace'), 'grand', 255.0),
  ((select id from service_catalog where category = 'actions_general' and name = 'Player action & Mechanism (reproducer- type) : Remove and replace'), 'upright', 255.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: cork or clip type, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: cork or clip type, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: cork or clip type, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: cork or clip tye, set'), 'upright', 55.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: cork or clip tye, set'), 'drop_action', 55.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: cork or clip tye, set'), 'birdcage', 55.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: standard type, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: standard type, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: standard type, each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: standard type, set'), 'upright', 110.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: standard type, set'), 'drop_action', 110.0),
  ((select id from service_catalog where category = 'bridle_straps' and name = 'Replace: standard type, set'), 'birdcage', 110.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch: Repalce, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch: Repalce, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch: Repalce, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch: Repalce, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch: Repalce, set'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch: Repalce, set'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch shank: Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch shank: Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch shank: Replace, each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch shank: Replace, set'), 'upright', 365.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch shank: Replace, set'), 'drop_action', 425.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch shank: Replace, set'), 'birdcage', 425.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch buckskin: Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch buckskin: Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch buckskin: Replace, each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch buckskin: Replace, set'), 'upright', 290.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch buckskin: Replace, set'), 'drop_action', 332.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Backcatch buckskin: Replace, set'), 'birdcage', 332.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Billings Flange: Replace, each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Billings Flange: Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Billings Flange: Replace, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Billings Flange: Replace, set'), 'grand', 365.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Billings Flange: Replace, set'), 'upright', 402.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Billings Flange: Replace, set'), 'drop_action', 425.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Brass Plate: Replace, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Brass Plate: Replace, set'), 'upright', 500.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Brass Rail: Replace, exact copy'), 'upright', 885.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Brass Rail: Modify to use European- style flanges'), 'upright', 1770.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt and Flange, new: Replace, each'), 'upright', 22.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt and Flange, new: Replace, each'), 'drop_action', 26.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt and Flange, new: Replace, each'), 'birdcage', 33.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt and Flange, new: Replace, set'), 'upright', 575.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt and Flange, new: Replace, set'), 'drop_action', 575.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt and Flange, new: Replace, set'), 'birdcage', 575.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt Felt: Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt Felt: Replace, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt Felt: Replace, each'), 'square_grand', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt Felt: Replace, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt Felt: Replace, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt Felt: Replace, set'), 'drop_action', 202.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt Felt: Replace, set'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt Felt: Replace, set'), 'birdcage', 202.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt leather w/ underfelt: Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt leather w/ underfelt: Replace, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt leather w/ underfelt: Replace, each'), 'square_grand', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt leather w/ underfelt: Replace, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt leather w/ underfelt: Replace, set'), 'upright', 402.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt leather w/ underfelt: Replace, set'), 'drop_action', 402.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt leather w/ underfelt: Replace, set'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Butt leather w/ underfelt: Replace, set'), 'birdcage', 402.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, each'), 'square_grand', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, set'), 'grand', 290.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, set'), 'upright', 332.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, set'), 'drop_action', 365.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, set'), 'square_grand', 365.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Repin, set'), 'birdcage', 332.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, each'), 'square_grand', 20.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, set'), 'grand', 365.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, set'), 'upright', 402.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, set'), 'drop_action', 425.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Replace, set'), 'birdcage', 425.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Rebush (both sides), each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Rebush (both sides), each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Rebush (both sides), each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Rebush (both sides), each'), 'square_grand', 19.5),
  ((select id from service_catalog where category = 'butts_flanges' and name = 'Flange: Rebush (both sides), each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, each'), 'grand', 9.75),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, each'), 'square_grand', 19.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, set'), 'grand', 425.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, set'), 'upright', 290.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, set'), 'drop_action', 365.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, set'), 'square_grand', 575.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper Felt: Replace, set'), 'birdcage', 512.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper flange: Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper flange: Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper flange: Replace, each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper flange: Replace, set'), 'upright', 365.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper flange: Replace, set'), 'drop_action', 425.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lever assembly: Replace, each'), 'upright', 32.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lever assembly: Replace, each'), 'drop_action', 55.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lever assembly: Replace, set (includes alignment and regulation)'), 'upright', 575.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lever assembly: Replace, set (includes alignment and regulation)'), 'drop_action', 645.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lever flange: Repin or replace, each'), 'grand', 32.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lever flange: Repin or replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lever flange: Repin or replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lever flange: Repin or replace, each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift rod: Clean & lubricate'), 'grand', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift rod: Clean & lubricate'), 'upright', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift rod: Clean & lubricate'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift rod: Clean & lubricate'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift rod/tray pivots: Replace/repair'), 'grand', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift rod/tray pivots: Replace/repair'), 'upright', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift rod/tray pivots: Replace/repair'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift rod/tray pivots: Replace/repair'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, each'), 'drop_action', 22.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, set'), 'grand', 182.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, set'), 'upright', 252.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, set'), 'drop_action', 252.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, set'), 'square_grand', 365.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper lift felt: Replace, set'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper spring groove: Teflon, remove/replace with new punching, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper spring groove: Teflon, remove/replace with new punching, each'), 'drop_action', 22.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper spring groove: Teflon, remove/replace with new punching, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper spring groove: Teflon, remove/replace with new punching, set'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper spring punching: Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper spring punching: Replace, each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper spring punching: Replace, set'), 'upright', 110.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper spring punching: Replace, set'), 'drop_action', 126.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper top flange: Replace, each'), 'grand', 55.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper top flange: Replace, set'), 'grand', 332.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper wood block w/new felt: Replace, each'), 'upright', 9.75),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper wood block w/new felt: Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper wood block w/new felt: Replace, set'), 'upright', 332.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Damper wood block w/new felt: Replace, set'), 'drop_action', 365.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Grand damper guide rail bushing: Ease, each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Grand damper guide rail bushing: Replace, each'), 'grand', 36.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Grand damper guide rail bushing: Replace, set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'dampers' and name = 'Grand damper guide rail:Reapair, set'), 'grand', 624.75),
  ((select id from service_catalog where category = 'dampers' and name = 'Grand damper guide rail: Repair, refurbish & refelt'), 'grand', 145.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Grand damper tray: Remove, rebuild, install'), 'grand', 290.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Grand damper tray: Remove, rebuild, install'), 'square_grand', 870.0),
  ((select id from service_catalog where category = 'dampers' and name = 'Underlever flange screws: Tighten, set'), 'grand', 55.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Butt spring punching: Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Butt spring punching: Replace, each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Butt spring punching: Replace, each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Butt spring punching: Replace, set'), 'upright', 145.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Butt spring punching: Replace, set'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Butt spring punching: Replace, set'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand action sfhift rebound felt: Replace'), 'grand', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand action shift rebound felt (on repetition lever): each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand jack button punching: Each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand jack button punching: set'), 'grand', 290.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand key upstop rail felt: Replace'), 'grand', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand repetition lever cloth (or leather): Each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand repetition lever cloth (or leather): set'), 'grand', 290.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand repetition stop button punching: Each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Grand repetition stop button punching: set'), 'grand', 290.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rail pivot bushing: Replace, each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rail pivot bushing: Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rail pivot bushing: Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rail pivot bushing: Replace, each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rest rail felt: Replace'), 'grand', 73.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rest rail felt: Replace'), 'upright', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rest rail felt: Replace'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rest rail felt: Replace'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Hammer rest rail felt: Replace'), 'birdcage', 55.0),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Each'), 'square_grand', 7.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Set'), 'grand', 110.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Set'), 'upright', 110.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Set'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Set'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Let off punching, replace: Set'), 'birdcage', 110.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Muffler felt: Replace, strip'), 'upright', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Muffler felt: Replace, strip'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Muffler felt: Replace, strip'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Nameboard felt: Replace'), 'grand', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Nameboard felt: Replace'), 'upright', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Nameboard felt: Replace'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Nameboard felt: Replace'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Nameboard felt: Replace'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Spring rail felt: Replace'), 'upright', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Spring rail felt: Replace'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Spring rail felt: Replace'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'felt_leather' and name = 'Sticker felt: Replace, set'), 'upright', 73.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Set'), 'grand', 90.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Set'), 'upright', 90.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Set'), 'drop_action', 90.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Set'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Boring: Set'), 'birdcage', 90.5),
  ((select id from service_catalog where category = 'hammers' and name = '"Buckskinning" hammer surface: Each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = '"Buckskinning" hammer surface: Each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = '"Buckskinning" hammer surface: Each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = '"Buckskinning" hammer surface: Each'), 'square_grand', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = '"Buckskinning" hammer surface: Each'), 'birdcage', 22.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammer flange rail sandpaper: Replace'), 'grand', 73.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, first'), 'grand', 7.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, first'), 'upright', 7.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, first'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, first'), 'square_grand', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, first'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose Hammers: Reglue, after first'), 'grand', 3.75),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose Hammers: Reglue, after first'), 'upright', 3.75),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose Hammers: Reglue, after first'), 'drop_action', 3.75),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose Hammers: Reglue, after first'), 'square_grand', 7.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose Hammers: Reglue, after first'), 'birdcage', 3.75),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, set'), 'grand', 182.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, set'), 'upright', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, set'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, set'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue, set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue w/hide glue & water, set'), 'grand', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue w/hide glue & water, set'), 'upright', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue w/hide glue & water, set'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue w/hide glue & water, set'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Loose hammers: Reglue w/hide glue & water, set'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammer: Install, each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammer: Install, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammer: Install, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammer: Install, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammer: Install, each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install, set'), 'grand', 575.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install, set'), 'upright', 575.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install, set'), 'drop_action', 575.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install, set'), 'square_grand', 1150.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install, set'), 'birdcage', 575.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install w/ shanks and butts'), 'upright', 885.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install w/ shanks and butts'), 'drop_action', 885.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install w/ shanks and butts'), 'birdcage', 885.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install w/ shanks and flanges'), 'grand', 810.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install w/ new shanks ONLY'), 'grand', 885.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install w/ new shanks ONLY'), 'upright', 735.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install w/ new shanks ONLY'), 'drop_action', 735.0),
  ((select id from service_catalog where category = 'hammers' and name = 'New hammers: Install w/ new shanks ONLY'), 'square_grand', 1770.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Replace hammers (with used or new/old stock): When plug and redrill is required, each'), 'grand', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Replace hammers (with used or new/old stock): When plug and redrill is required, each'), 'upright', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Replace hammers (with used or new/old stock): When plug and redrill is required, each'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Replace hammers (with used or new/old stock): When plug and redrill is required, each'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Replace hammers (with used or new/old stock): When plug and redrill is required, each'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: Replace, each'), 'grand', 30.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: Replace, each'), 'upright', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: Replace, each'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: Replace, each'), 'square_grand', 55.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: Replace, each'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: replace, set'), 'grand', 220.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: replace, set'), 'upright', 290.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: replace, set'), 'drop_action', 290.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: replace, set'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Hammershank: replace, set'), 'birdcage', 290.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Shank sleeves: Metal type (not recommended), each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Shank sleeves: Metal type (not recommended), each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Shank sleeves: Metal type (not recommended), each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Shank sleeves: Metal type (not recommended), each'), 'square_grand', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Shank sleeves: Metal type (not recommended), each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Surfacing ("reshaping"): Set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Surfacing ("reshaping"): Set'), 'upright', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Surfacing ("reshaping"): Set'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Surfacing ("reshaping"): Set'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Surfacing ("reshaping"): Set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, each'), 'square_grand', 7.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, set'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, set'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'hammers' and name = 'Traveling: Shank, set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Acrylic repair (of ivory): Each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Acrylic repair (of ivory): Each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Acrylic repair (of ivory): Each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Acrylic repair (of ivory): Each'), 'square_grand', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Acrylic repair (of ivory): Each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Capstans: Buff, set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Capstans: Buff, set'), 'upright', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Capstans: Buff, set'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Capstans: Coat w/Emralon, (after buffing), set'), 'grand', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Capstans: Coat w/Emralon, (after buffing), set'), 'upright', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Capstans: Coat w/Emralon, (after buffing), set'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Grand backcheck block and/or felt: Replace, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Grand backcheck block and/or felt: Replace, each'), 'square_grand', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Grand backcheck block and/or felt: Replace, set'), 'grand', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Grand backcheck block and/or felt: Replace, set'), 'square_grand', 365.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Grand backcheck felt and/or leather: Resurface, set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Grand backcheck felt and/or leather: Resurface, set'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Grand backcheck wire: Replace, each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Grand backcheck wire: Replace, each'), 'square_grand', 30.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, set'), 'grand', 399.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, set'), 'upright', 365.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, set'), 'drop_action', 365.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, set'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key button: Replace, set'), 'birdcage', 425.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Bed to keybed'), 'grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Bed to keybed'), 'upright', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Bed to keybed'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Bed to keybed'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Bed to keybed'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, single rail ONLY'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, single rail ONLY'), 'upright', 55.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, single rail ONLY'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, single rail ONLY'), 'square_grand', 90.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, single rail ONLY'), 'birdcage', 55.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, front, center & back rail'), 'grand', 126.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, front, center & back rail'), 'upright', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, front, center & back rail'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, front, center & back rail'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, front, center & back rail'), 'birdcage', 126.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, complete'), 'grand', 425.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, complete'), 'upright', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, complete'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, complete'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyframe: Refelt, complete'), 'birdcage', 245.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Ease bushings (both rails) set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Ease bushings (both rails) set'), 'upright', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Ease bushings (both rails) set'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Ease bushings (both rails) set'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Ease bushings (both rails) set'), 'birdcage', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushing (front or balance), each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushing (front or balance), each'), 'upright', 9.75),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushing (front or balance), each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushing (front or balance), each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushing (front or balance), each'), 'birdcage', 9.75),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushings (1 rail only), set'), 'grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushings (1 rail only), set'), 'upright', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushings (1 rail only), set'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushings (1 rail only), set'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Replace bushings (1 rail only), set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: replace bushings (both rails) set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: replace bushings (both rails) set'), 'upright', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: replace bushings (both rails) set'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: replace bushings (both rails) set'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: replace bushings (both rails) set'), 'birdcage', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Polish, (both rails) set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Polish, (both rails) set'), 'upright', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Polish, (both rails) set'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Polish, (both rails) set'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Polish, (both rails) set'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, one rail'), 'grand', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, one rail'), 'upright', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, one rail'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, one rail'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, one rail'), 'birdcage', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, both rails'), 'grand', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, both rails'), 'upright', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, both rails'), 'drop_action', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, both rails'), 'square_grand', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Key pin: Replace, set, both rails'), 'birdcage', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight, set'), 'grand', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight, set'), 'upright', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight, set'), 'drop_action', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight, set'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight, set'), 'birdcage', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight w/jiffy leads, set (NOT RECOMMENDED)'), 'grand', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight w/jiffy leads, set (NOT RECOMMENDED)'), 'upright', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight w/jiffy leads, set (NOT RECOMMENDED)'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight w/jiffy leads, set (NOT RECOMMENDED)'), 'square_grand', 290.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Balance & weight w/jiffy leads, set (NOT RECOMMENDED)'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Level & set dip after replacing tops, set'), 'grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Level & set dip after replacing tops, set'), 'upright', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Level & set dip after replacing tops, set'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Level & set dip after replacing tops, set'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keys: Level & set dip after replacing tops, set'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, each'), 'square_grand', 9.75),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, set'), 'upright', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, set'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, set'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keyfronts: Replace, plastic, set'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Clean, sand & buff set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Clean, sand & buff set'), 'upright', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Clean, sand & buff set'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Clean, sand & buff set'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Clean, sand & buff set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Replace/reglue, head or tail, each'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Replace/reglue, head or tail, each'), 'upright', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Replace/reglue, head or tail, each'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Replace/reglue, head or tail, each'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Replace/reglue, head or tail, each'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Replace/reglue, head or tail, set'), 'grand', 5800.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: Replace/reglue, head or tail, set'), 'square_grand', 6526.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: "Waterfall" (remove lip), set'), 'grand', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: "Waterfall" (remove lip), set'), 'upright', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: "Waterfall" (remove lip), set'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: "Waterfall" (remove lip), set'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, ivory: "Waterfall" (remove lip), set'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Clean, sand & buff set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Clean, sand & buff set'), 'upright', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Clean, sand & buff set'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Clean, sand & buff set'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Clean, sand & buff set'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, Clean sharps, set'), 'grand', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, Clean sharps, set'), 'upright', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, Clean sharps, set'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, Clean sharps, set'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, Clean sharps, set'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops: Clean sides & "re-black" sharps, (stick only)'), 'grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops: Clean sides & "re-black" sharps, (stick only)'), 'upright', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops: Clean sides & "re-black" sharps, (stick only)'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops: Clean sides & "re-black" sharps, (stick only)'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops: Clean sides & "re-black" sharps, (stick only)'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops plastic: Replace, each'), 'grand', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops plastic: Replace, each'), 'upright', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops plastic: Replace, each'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops plastic: Replace, each'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops plastic: Replace, each'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Replace, set'), 'grand', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Replace, set'), 'upright', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Replace, set'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Replace, set'), 'square_grand', 290.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keytops, plastic: Replace, set'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Paint, set (NOT RECOMMENDED)'), 'grand', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Paint, set (NOT RECOMMENDED)'), 'upright', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Paint, set (NOT RECOMMENDED)'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Paint, set (NOT RECOMMENDED)'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Paint, set (NOT RECOMMENDED)'), 'birdcage', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace, each'), 'grand', 22.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace, each'), 'square_grand', 45.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace, each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace,set'), 'grand', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace,set'), 'upright', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace,set'), 'drop_action', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace,set'), 'square_grand', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, ebony: Replace,set'), 'birdcage', 332.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, set'), 'grand', 182.5),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, set'), 'upright', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, set'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, set'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Sharps, plastic: Replace, set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keystick: Laminate top, surface, set'), 'grand', 885.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keystick: Laminate top, surface, set'), 'upright', 885.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keystick: Laminate top, surface, set'), 'drop_action', 885.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keystick: Laminate top, surface, set'), 'square_grand', 885.0),
  ((select id from service_catalog where category = 'keys_keybed_keyframe' and name = 'Keystick: Laminate top, surface, set'), 'birdcage', 885.0),
  ((select id from service_catalog where category = 'knuckles' and name = 'Knuckle:  Bolster/file/lubricate, etc., set'), 'grand', 182.5),
  ((select id from service_catalog where category = 'knuckles' and name = 'Knuckle:  Refelt & Replace buckskin, each'), 'grand', 55.0),
  ((select id from service_catalog where category = 'knuckles' and name = 'Knuckle:  Refelt & Replace buckskin, each'), 'drop_action', 55.0),
  ((select id from service_catalog where category = 'knuckles' and name = 'Knuckle:  Refelt & Replace buckskin, set'), 'grand', 725.0),
  ((select id from service_catalog where category = 'knuckles' and name = 'Knuckle:  Refelt & Replace buckskin, set'), 'drop_action', 725.0),
  ((select id from service_catalog where category = 'knuckles' and name = 'Knuckle:  Replace, each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'knuckles' and name = 'Knuckle:  Replace, set'), 'grand', 365.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Damper pitman rod, wood:  Replace, each'), 'grand', 36.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Damper pitman rod, wood:  Replace, each'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Damper pitman rod, brass:  Replace, each'), 'grand', 73.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Lyre braces:  Replac, set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Lyre braces:  Replac, set'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Lyre pedal rods:  Replace, set'), 'grand', 110.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Lyre pedal rods:  Replace, set'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Lyre:  General recondition/ rebuild'), 'grand', 182.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Lyre:  General recondition/ rebuild'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pins:  Replace, each'), 'grand', 22.3),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pins:  Replace, each'), 'upright', 30.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pins:  Replace, each'), 'drop_action', 30.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pins:  Replace, each'), 'square_grand', 30.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pins:  Replace, each'), 'birdcage', 55.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pivots:  Rebush & lube, set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pivots:  Rebush & lube, set'), 'upright', 110.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pivots:  Rebush & lube, set'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal pivots:  Rebush & lube, set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, each'), 'upright', 22.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, each'), 'drop_action', 30.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, each'), 'square_grand', 15.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, each'), 'birdcage', 22.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, set'), 'grand', 36.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, set'), 'upright', 55.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, set'), 'drop_action', 55.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, set'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods guide bushing:  Replace, set'), 'birdcage', 55.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods:  replace, each'), 'grand', 73.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods:  replace, each'), 'upright', 36.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods:  replace, each'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods:  replace, each'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal rods:  replace, each'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal spring:  Replace, each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal spring:  Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal spring:  Replace, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal spring:  Replace, each'), 'square_grand', 20.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedal spring:  Replace, each'), 'birdcage', 22.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedals:  Replace, set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedals:  Replace, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedals:  Replace, set'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedals:  Replace, set'), 'square_grand', 290.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Pedals:  Replace, set'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Sostenuto monkey:  Replace, each'), 'grand', 36.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Trapwork:  Reconditioning/ repair'), 'grand', 145.0),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Trapwork:  Reconditioning/ repair'), 'upright', 110.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Trapwork:  Reconditioning/ repair'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Trapwork:  Reconditioning/ repair'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'lyres_pedals_trapwork' and name = 'Trapwork:  Reconditioning/ repair'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Action: Partial regulation'), 'grand', 526.5),
  ((select id from service_catalog where category = 'regulation' and name = 'Action: Partial regulation'), 'upright', 365.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Action: Partial regulation'), 'drop_action', 457.5),
  ((select id from service_catalog where category = 'regulation' and name = 'Action: Partial regulation'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Action: Partial regulation'), 'birdcage', 425.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Action:  Major regulation: Complete'), 'grand', 1050.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Action:  Major regulation: Complete'), 'upright', 626.5),
  ((select id from service_catalog where category = 'regulation' and name = 'Action:  Major regulation: Complete'), 'drop_action', 725.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Action:  Major regulation: Complete'), 'square_grand', 1050.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Action:  Major regulation: Complete'), 'birdcage', 725.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Damers:  Partial regulation, set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Damers:  Partial regulation, set'), 'upright', 110.5),
  ((select id from service_catalog where category = 'regulation' and name = 'Damers:  Partial regulation, set'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'regulation' and name = 'Damers:  Partial regulation, set'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'regulation' and name = 'Damers:  Partial regulation, set'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Dampers:  Major regulation (from scatch)'), 'grand', 575.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Dampers:  Major regulation (from scatch)'), 'upright', 425.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Dampers:  Major regulation (from scatch)'), 'drop_action', 457.5),
  ((select id from service_catalog where category = 'regulation' and name = 'Dampers:  Major regulation (from scatch)'), 'square_grand', 725.0),
  ((select id from service_catalog where category = 'regulation' and name = 'Dampers:  Major regulation (from scatch)'), 'birdcage', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, recap'), 'grand', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, recap'), 'upright', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, recap'), 'drop_action', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, recap'), 'square_grand', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, recap'), 'birdcage', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, replace'), 'grand', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, replace'), 'upright', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, replace'), 'drop_action', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, replace'), 'square_grand', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, curved type, replace'), 'birdcage', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, recap'), 'grand', 425.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, recap'), 'upright', 425.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, recap'), 'drop_action', 425.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, recap'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, recap'), 'birdcage', 425.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, replace'), 'grand', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, replace'), 'upright', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, replace'), 'drop_action', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, replace'), 'square_grand', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Bass, straight type, replace'), 'birdcage', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Reglue old'), 'grand', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Reglue old'), 'upright', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Reglue old'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Reglue old'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Reglue old'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, major cracks'), 'grand', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, major cracks'), 'upright', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, major cracks'), 'drop_action', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, major cracks'), 'square_grand', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, major cracks'), 'birdcage', 490.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, minor cracks'), 'grand', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, minor cracks'), 'upright', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, minor cracks'), 'drop_action', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, minor cracks'), 'square_grand', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Repair, epoxy, minor cracks'), 'birdcage', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap, per unison'), 'grand', 55.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap, per unison'), 'upright', 55.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap, per unison'), 'drop_action', 55.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap, per unison'), 'square_grand', 55.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap, per unison'), 'birdcage', 55.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap entire bridge'), 'grand', 1400.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap entire bridge'), 'upright', 1400.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap entire bridge'), 'drop_action', 1225.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap entire bridge'), 'square_grand', 2250.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, recap entire bridge'), 'birdcage', 1775.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, per unison'), 'grand', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, per unison'), 'upright', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, per unison'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, per unison'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, per unison'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, entire bridge'), 'grand', 1660.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, entire bridge'), 'upright', 1660.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, entire bridge'), 'drop_action', 1575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, entire bridge'), 'square_grand', 2800.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Bridge:  Treble, replace, entire bridge'), 'birdcage', 2100.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Rebronze'), 'grand', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Rebronze'), 'upright', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Rebronze'), 'drop_action', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Rebronze'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Rebronze'), 'birdcage', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Removal'), 'grand', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Removal'), 'upright', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Removal'), 'drop_action', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Removal'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Removal'), 'birdcage', 290.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clean'), 'grand', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clean'), 'upright', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clean'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clean'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clean'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clear & clear coat w/ laquer'), 'grand', 182.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clear & clear coat w/ laquer'), 'upright', 182.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clear & clear coat w/ laquer'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clear & clear coat w/ laquer'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Clear & clear coat w/ laquer'), 'birdcage', 182.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Installation'), 'grand', 425.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Installation'), 'upright', 457.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Installation'), 'drop_action', 457.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Installation'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Installation'), 'birdcage', 457.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Weld (NOT GUARANTEED, AND WILL BE CONTRACTED OUT.)'), 'grand', 526.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Weld (NOT GUARANTEED, AND WILL BE CONTRACTED OUT.)'), 'upright', 526.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Weld (NOT GUARANTEED, AND WILL BE CONTRACTED OUT.)'), 'drop_action', 526.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Weld (NOT GUARANTEED, AND WILL BE CONTRACTED OUT.)'), 'square_grand', 526.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Plate:  Weld (NOT GUARANTEED, AND WILL BE CONTRACTED OUT.)'), 'birdcage', 526.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Ribs:  Re-attach to soundboard, each'), 'grand', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Ribs:  Re-attach to soundboard, each'), 'upright', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Ribs:  Re-attach to soundboard, each'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Ribs:  Re-attach to soundboard, each'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Ribs:  Re-attach to soundboard, each'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, lacquer'), 'grand', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, lacquer'), 'upright', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, lacquer'), 'drop_action', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, lacquer'), 'square_grand', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, lacquer'), 'birdcage', 575.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, olde method, varnish'), 'grand', 1050.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, olde method, varnish'), 'upright', 1050.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, olde method, varnish'), 'drop_action', 1050.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, olde method, varnish'), 'square_grand', 1050.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Refinish, olde method, varnish'), 'birdcage', 1050.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Replace, w/ old bridges (5''-7'')'), 'grand', 1747.5),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Replace, w/ old bridges (5''-7'')'), 'upright', 1400.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Replace, w/ old bridges (7''-9'')'), 'grand', 2400.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Replace, w/ new bridges (5''-7'')'), 'grand', 3475.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Replace, w/ new bridges (5''-7'')'), 'upright', 3150.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard:  Replace, w/ new bridges (7''-9'')'), 'grand', 4565.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard buttons:  Replace, each'), 'grand', 9.75),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard buttons:  Replace, each'), 'upright', 9.75),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard buttons:  Replace, each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard buttons:  Replace, each'), 'square_grand', 9.75),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard buttons:  Replace, each'), 'birdcage', 9.75),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard shimming: Per foot'), 'grand', 15.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard shimming: Per foot'), 'upright', 15.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard shimming: Per foot'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard shimming: Per foot'), 'square_grand', 15.0),
  ((select id from service_catalog where category = 'soundboards_bridges_plates' and name = 'Soundboard shimming: Per foot'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Damper spring:  Replace, each'), 'grand', 73.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Damper spring:  Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Damper spring:  Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Damper sping:  Replace, set'), 'grand', 725.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Damper sping:  Replace, set'), 'upright', 457.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Damper sping:  Replace, set'), 'drop_action', 457.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Hammer spring:  Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Hammer spring:  Replace, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Hammer spring:  Replace, set'), 'upright', 290.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Hammer spring:  Replace, set'), 'drop_action', 290.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, each'), 'grand', 9.75),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, set'), 'grand', 290.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, set'), 'upright', 290.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, set'), 'drop_action', 290.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, set'), 'square_grand', 725.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring:  Replace, set'), 'birdcage', 575.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, first'), 'grand', 63.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, first'), 'upright', 45.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, first'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, first'), 'birdcage', 45.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, each after first'), 'grand', 7.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, each after first'), 'upright', 7.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, each after first'), 'square_grand', 15.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, each after first'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, set'), 'grand', 575.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, set'), 'upright', 490.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, set'), 'square_grand', 626.5),
  ((select id from service_catalog where category = 'springs_action' and name = 'Jack spring cord:  Replace, set'), 'birdcage', 490.0),
  ((select id from service_catalog where category = 'springs_action' and name = 'Repetition lever spring:  Replace, each'), 'grand', 9.75),
  ((select id from service_catalog where category = 'springs_action' and name = 'Repetition lever spring:  Replace, set'), 'grand', 365.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Agraffe:  Replace, each'), 'grand', 575.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings: Custom or Universal, first, each'), 'grand', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings: Custom or Universal, first, each'), 'upright', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings: Custom or Universal, first, each'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings: Custom or Universal, first, each'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings: Custom or Universal, first, each'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Custom or Universal, after first, each'), 'grand', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Custom or Universal, after first, each'), 'upright', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Custom or Universal, after first, each'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Custom or Universal, after first, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Custom or Universal, after first, each'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, each'), 'grand', 9.75),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, each'), 'upright', 9.75),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, each'), 'square_grand', 9.75),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, each'), 'birdcage', 9.75),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, set'), 'upright', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, set'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, set'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  Liven roll, twist & tune, set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (does not include new tuning pins)'), 'grand', 290.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (does not include new tuning pins)'), 'upright', 290.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (does not include new tuning pins)'), 'drop_action', 290.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (does not include new tuning pins)'), 'square_grand', 290.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (does not include new tuning pins)'), 'birdcage', 290.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, , 7''-9'' grands.'), 'grand', 365.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (includes new tuning pins, two tunings in home)'), 'grand', 626.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (includes new tuning pins, two tunings in home)'), 'upright', 626.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (includes new tuning pins, two tunings in home)'), 'drop_action', 626.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (includes new tuning pins, two tunings in home)'), 'square_grand', 626.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set (includes new tuning pins, two tunings in home)'), 'birdcage', 626.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Bass strings:  New, set, 7''-9'' grands'), 'grand', 725.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Pinblock restorer:  Apply, (no tuning)'), 'upright', 220.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Pinblock restorer:  Apply, (no tuning)'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Pinblock restorer:  Apply, (no tuning)'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Pinblock:  Replace'), 'grand', 865.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Pinblock:  Replace'), 'upright', 1165.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Pinblock:  Replace'), 'drop_action', 1165.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Pinblock:  Replace'), 'square_grand', 1400.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Pinblock:  Replace'), 'birdcage', 1165.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Restring:  Complete (Except 7''-9'' grands and square grands.  Includes new tuning pins, string braid, etc., and one home tuning within 30 days of delivery.)'), 'grand', 1565.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Restring:  Complete (Except 7''-9'' grands and square grands.  Includes new tuning pins, string braid, etc., and one home tuning within 30 days of delivery.)'), 'upright', 1565.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Restring:  Complete (Except 7''-9'' grands and square grands.  Includes new tuning pins, string braid, etc., and one home tuning within 30 days of delivery.)'), 'drop_action', 1565.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Restring:  Complete  (7''-9'' grands and quare grands, same as above.)'), 'grand', 1883.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Restring:  Complete  (7''-9'' grands and quare grands, same as above.)'), 'square_grand', 2026.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Seating, set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Seating, set'), 'upright', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Seating, set'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Seating, set'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Seating, set'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Splice (tie), bass or treble, each'), 'grand', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Splice (tie), bass or treble, each'), 'upright', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Splice (tie), bass or treble, each'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Splice (tie), bass or treble, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Strings:  Splice (tie), bass or treble, each'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Data gathering'), 'grand', 425.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Data gathering'), 'upright', 425.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Data gathering'), 'drop_action', 425.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Data gathering'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Data gathering'), 'birdcage', 425.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Evaluation: (calculation only.)'), 'grand', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Evaluation: (calculation only.)'), 'upright', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Evaluation: (calculation only.)'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Evaluation: (calculation only.)'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'String Scale: Evaluation: (calculation only.)'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Replace, (NOT in over strung area), each'), 'grand', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Replace, (NOT in over strung area), each'), 'upright', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Replace, (NOT in over strung area), each'), 'drop_action', 45.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Replace, (NOT in over strung area), each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Replace, (NOT in over strung area), each'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Repalce, (overstrung area), each'), 'grand', 45.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Repalce, (overstrung area), each'), 'upright', 45.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Repalce, (overstrung area), each'), 'drop_action', 55.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Repalce, (overstrung area), each'), 'square_grand', 45.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Treble strings:  Repalce, (overstrung area), each'), 'birdcage', 45.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Drive, NOT RECOMMENDED, set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Drive, NOT RECOMMENDED, set'), 'upright', 110.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Drive, NOT RECOMMENDED, set'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Drive, NOT RECOMMENDED, set'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Drive, NOT RECOMMENDED, set'), 'birdcage', 110.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized or shimmed, each'), 'grand', 22.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized or shimmed, each'), 'upright', 22.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized or shimmed, each'), 'drop_action', 22.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized or shimmed, each'), 'square_grand', 22.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized or shimmed, each'), 'birdcage', 22.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized, install, set (Includes one tuning)'), 'grand', 937.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized, install, set (Includes one tuning)'), 'upright', 937.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized, install, set (Includes one tuning)'), 'drop_action', 937.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized, install, set (Includes one tuning)'), 'square_grand', 937.5),
  ((select id from service_catalog where category = 'strings_tuning_pins' and name = 'Tuning pins:  Oversized, install, set (Includes one tuning)'), 'birdcage', 937.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Tuning:  One or two times per year'), 'grand', 145.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Tuning:  One or two times per year'), 'upright', 145.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Tuning:  One or two times per year'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Tuning:  One or two times per year'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Tuning:  One or two times per year'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  5 to 25 cents'), 'grand', 36.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  5 to 25 cents'), 'upright', 36.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  5 to 25 cents'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  5 to 25 cents'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  5 to 25 cents'), 'birdcage', 36.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  25 to 50 cents'), 'grand', 73.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  25 to 50 cents'), 'upright', 73.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  25 to 50 cents'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  25 to 50 cents'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  25 to 50 cents'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  More than 50 cents'), 'grand', 110.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  More than 50 cents'), 'upright', 110.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  More than 50 cents'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  More than 50 cents'), 'square_grand', 145.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Raise or lower pitch:  More than 50 cents'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Concert tuning  (Includes minor regulation)'), 'grand', 220.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Concert tuning  (Includes minor regulation)'), 'upright', 220.0),
  ((select id from service_catalog where category = 'tuning' and name = 'Yamah CP series electronic piano (and similar)'), 'grand', 110.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Fender Rhodes electronic piano (and similar)'), 'grand', 110.5),
  ((select id from service_catalog where category = 'tuning' and name = 'Reed Organs:  Per bank'), 'grand', 145.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheck block and/or felt/leather:  Replace,each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheck block and/or felt/leather:  Replace,each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheck block and/or felt/leather:  Replace,each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheck block and/or felt/leather:  Replace, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheck block and/or felt/leather:  Replace, set'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheck block and/or felt/leather:  Replace, set'), 'birdcage', 290.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheck block w/ wire attached:  Set'), 'upright', 220.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheck block w/ wire attached:  Set'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheckwire:  Replace, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheckwire:  Replace, each'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Backcheckwire:  Replace, each'), 'birdcage', 27.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Balancer spring retainer:  Replace, set'), 'grand', 110.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Balancer spring retainer bushingL:  replace, set'), 'grand', 365.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Bridle wire:  Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Bridle wire:  Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Bridle wire:  Replace, each'), 'birdcage', 20.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Bridle wire:  Replace, set'), 'upright', 220.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Bridle wire:  Replace, set'), 'drop_action', 220.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Bridle wire:  Replace, set'), 'birdcage', 220.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Cushion cloth (capstan contact felt):  Replace, each'), 'grand', 9.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Cushion cloth (capstan contact felt):  Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Cushion cloth (capstan contact felt):  Replace, each'), 'drop_action', 3.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Cushion cloth (capstan contact felt):  Replace, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Cushion cloth (capstan contact felt):  Replace, set'), 'grand', 220.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Cushion cloth (capstan contact felt):  Replace, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Cushion cloth (capstan contact felt):  Replace, set'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Cushion cloth (capstan contact felt):  Replace, set'), 'birdcage', 182.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Elbow, plastic (snap-on type):  Replace, first'), 'drop_action', 17.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Elbow, plastic (snap-on type):  Replace, each, after the first'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Elbow, plastic (snap- on type):  Set'), 'drop_action', 290.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Elbow:  Replace with wood or plastic, first'), 'drop_action', 36.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Elbow:  Replace with wood or plastic, after  first'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Elbow:  Replace with wood or plastic, set'), 'drop_action', 440.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Alignment in window, set'), 'grand', 73.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack rebound felt:  Replace, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack rebound felt:  Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack rebound felt:  Replace, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack rebound felt:  Replace, each'), 'square_grand', 20.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack rebound felt:  Replace, each'), 'birdcage', 9.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack rebound felt:  Repalce, set'), 'grand', 110.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack rebound felt:  Repalce, set'), 'upright', 110.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack rebound felt:  Repalce, set'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Reglue (tongue or flange.), each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Reglue (tongue or flange.), each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Reglue (tongue or flange.), each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Reglue (tongue or flange.), each'), 'birdcage', 15.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Reglue (tongue or flange.), set'), 'grand', 425.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Reglue (tongue or flange.), set'), 'upright', 110.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Reglue (tongue or flange.), set'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, each'), 'square_grand', 36.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, each'), 'birdcage', 9.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, set'), 'grand', 290.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, set'), 'upright', 325.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, set'), 'drop_action', 325.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, set'), 'square_grand', 425.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Repin, set'), 'birdcage', 325.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, each'), 'grand', 20.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, each'), 'upright', 20.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, each'), 'drop_action', 22.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, each'), 'square_grand', 55.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, each'), 'birdcage', 22.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, set'), 'grand', 400.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, set'), 'upright', 425.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, set'), 'drop_action', 425.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, set'), 'square_grand', 1770.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Jack:  Replace, set'), 'birdcage', 575.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Lifters:  Rubber grommets, set (Add $72.50 for regulating lost motion, etc.)'), 'square_grand', 73.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Lifters:  Plastics grommets w/ fiber nut, set (Add $72.5 for regulatimg lost motion, etc)'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Spoon:  Replace, each'), 'grand', 15.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Spoon:  Replace, each'), 'upright', 15.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Spoon:  Replace, each'), 'drop_action', 15.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Spoon:  Replace, set'), 'grand', 365.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Spoon:  Replace, set'), 'upright', 400.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Spoon:  Replace, set'), 'drop_action', 400.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Sticker:  Adjustable, replace, each'), 'upright', 22.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Replace, each (Includes regulation)'), 'grand', 73.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Replace, each (Includes regulation)'), 'upright', 15.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Replace, each (Includes regulation)'), 'drop_action', 20.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Replace, each (Includes regulation)'), 'birdcage', 22.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Replace, set (Does not Includes regulation)'), 'grand', 290.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Replace, set (Does not Includes regulation)'), 'upright', 220.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Replace, set (Does not Includes regulation)'), 'drop_action', 255.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Replace, set (Does not Includes regulation)'), 'birdcage', 290.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Rebuild w/ new felt, etc., set (Includes travel.)'), 'grand', 1400.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Rebuild w/ new felt, etc., set (Includes travel.)'), 'upright', 1025.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Rebuild w/ new felt, etc., set (Includes travel.)'), 'drop_action', 1025.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Rebuild w/ new felt, etc., set (Includes travel.)'), 'birdcage', 1025.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Travel, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Travel, each'), 'upright', 9.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Travel, each'), 'drop_action', 9.75),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Travel, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Travel, set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Travel, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Travel, set'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'wippens' and name = 'Wippen:  Travel, set'), 'birdcage', 145.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Casters:  Replace, set'), 'grand', 145.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Casters:  Replace, set'), 'upright', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Casters:  Replace, set'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Casters:  Replace, set'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Casters:  Replace, set'), 'birdcage', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Cleaning of piano:  Complete, interior/exterior'), 'grand', 255.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Cleaning of piano:  Complete, interior/exterior'), 'upright', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Cleaning of piano:  Complete, interior/exterior'), 'drop_action', 167.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Cleaning of piano:  Complete, interior/exterior'), 'square_grand', 325.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Cleaning of piano:  Complete, interior/exterior'), 'birdcage', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Partial system'), 'grand', 73.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Partial system'), 'upright', 73.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Partial system'), 'drop_action', 73.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Partial system'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Partial system'), 'birdcage', 73.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Complete system'), 'grand', 145.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Complete system'), 'upright', 145.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Complete system'), 'drop_action', 145.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Complete system'), 'square_grand', 220.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = '"Dampp-Chaser" installation:  Complete system'), 'birdcage', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Hinge pins:  Replace, each'), 'grand', 7.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Hinge pins:  Replace, each'), 'upright', 7.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Hinge pins:  Replace, each'), 'drop_action', 7.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Hinge pins:  Replace, each'), 'square_grand', 7.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Hinge pins:  Replace, each'), 'birdcage', 7.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Reed Organ:  Rebuild, Complete'), 'grand', 2700.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Reed Organ:  Reconditioning'), 'grand', 1050.0),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vacumming and mothproofing'), 'grand', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vacumming and mothproofing'), 'upright', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vacumming and mothproofing'), 'drop_action', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vacumming and mothproofing'), 'square_grand', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vacumming and mothproofing'), 'birdcage', 182.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vermin & insect eradication                      (Does not include moving expenses.)'), 'grand', 110.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vermin & insect eradication                      (Does not include moving expenses.)'), 'upright', 110.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vermin & insect eradication                      (Does not include moving expenses.)'), 'drop_action', 110.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vermin & insect eradication                      (Does not include moving expenses.)'), 'square_grand', 110.5),
  ((select id from service_catalog where category = 'miscellaneous' and name = 'Vermin & insect eradication                      (Does not include moving expenses.)'), 'birdcage', 110.5);


-- ============================================================
-- PIANOS
-- ============================================================
create table pianos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  make text not null,
  model text,
  serial_number text,
  piano_type text, -- 'grand' | 'upright' | 'digital' etc, free text is fine to start
  room_location text, -- where in the home it lives, e.g. "Living Room", "Basement"
  last_service_date date,
  service_interval_months int default 6,
  notes text,
  created_at timestamptz not null default now()
);
create index on pianos (client_id);

-- ============================================================
-- SERVICE RECORDS
-- Historical log — every tuning, repair, regulation, voicing, rebuild step.
-- ============================================================
create table service_records (
  id uuid primary key default gen_random_uuid(),
  piano_id uuid not null references pianos(id) on delete cascade,
  service_type text not null, -- 'tuning' | 'regulation' | 'voicing' | 'repair' | 'rebuild' | 'evaluation'
  performed_at date not null,
  summary text,
  created_at timestamptz not null default now()
);
create index on service_records (piano_id);

-- ============================================================
-- PROPOSED WORK
-- Work you (the owner) propose. Clients can self-schedule against
-- these once you've created them. This is what drives the
-- "dentist-style reminder" flow.
-- ============================================================
-- 'in_progress' is for shop-only phases (refinishing, restringing) that have
-- no client appointment at all — they go proposed -> in_progress -> completed,
-- set directly by the owner, never through book_slot(). Phases requiring an
-- actual visit still go proposed -> scheduled -> completed as before.
create type work_status as enum ('proposed', 'scheduled', 'in_progress', 'completed', 'declined');

create table proposed_work (
  id uuid primary key default gen_random_uuid(),
  piano_id uuid not null references pianos(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  description text not null,
  location_type location_type not null default 'in_home',
  status work_status not null default 'proposed',
  requires_scheduling boolean not null default true, -- false for shop-only phases with no client appointment
  depends_on_previous boolean not null default false, -- carried from the line item; enforced in start_phase()
  proposed_window text,       -- human-readable, e.g. "Week of Sep 21"
  target_completion_date date, -- rough estimate for long phases, not a hard commitment
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at date,
  created_at timestamptz not null default now()
);
create index on proposed_work (client_id);
create index on proposed_work (status);

-- ============================================================
-- AVAILABILITY SLOTS
-- Open slots you publish; clients pick one when self-scheduling.
-- Keep this simple to start — a real calendar sync (Google Calendar)
-- can replace this table later without changing anything upstream.
-- ============================================================
create table availability_slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  duration_minutes int not null default 90,
  location_type location_type not null default 'in_home',
  is_booked boolean not null default false,
  created_at timestamptz not null default now()
);
create index on availability_slots (location_type, is_booked);

-- ============================================================
-- LEADS
-- Public prospect submissions from the SEO landing page. No auth
-- required to submit — anyone can INSERT, nobody but the owner can
-- read, update, or delete. This is the only table anonymous
-- visitors can write to, and only ever in this one narrow way.
-- Defined before ESTIMATES since estimates references it.
-- ============================================================
create type lead_status as enum ('new', 'contacted', 'quoted', 'converted', 'closed');

create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  zip text,
  distance_miles numeric,
  piano_type text,       -- 'grand' | 'upright' | 'digital' | 'unsure'
  service_needed text,   -- 'tuning' | 'repair' | 'evaluation' | 'rebuild' | 'not sure'
  message text,
  source text default 'website',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  status lead_status not null default 'new',
  converted_client_id uuid references clients(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table leads enable row level security;

create policy "leads_owner_full_access" on leads
  for all using (is_owner()) with check (is_owner());
-- Deliberately NO public insert policy. An earlier version had
-- `for insert to anon, authenticated with check (true)`, which let anyone
-- write directly to Supabase's REST API using the public anon key —
-- completely bypassing the honeypot and validation in
-- app/api/leads/route.ts, since RLS is enforced below the application,
-- not through it. Lead creation now goes exclusively through that route,
-- which uses the service role key server-side (see the route for why
-- that's safe: the validation lives there instead of in a wide-open
-- policy).

-- ============================================================
-- ESTIMATES
-- Where proposed work originates. You create an estimate (possibly
-- for a prospect who isn't a client yet), add line items, and once
-- it's accepted it generates the proposed_work row(s) clients see
-- in their portal.
-- ============================================================
create type estimate_status as enum ('draft', 'sent', 'accepted', 'declined');

create table estimates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  lead_id uuid references leads(id) on delete set null, -- for prospects, see below
  piano_id uuid references pianos(id) on delete set null,
  status estimate_status not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  responded_at timestamptz,
  constraint estimate_has_a_target check (client_id is not null or lead_id is not null)
);
create index on estimates (client_id);
create index on estimates (lead_id);

create table estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  description text not null,
  amount numeric(10,2) not null,
  location_type location_type not null default 'in_home',
  requires_client_visit boolean not null default true, -- false for shop-only phases (refinishing, restringing) with no appointment
  estimated_duration_days int, -- rough estimate for long phases, shown to set expectations, not enforced
  depends_on_previous boolean not null default false, -- true if this phase can't start until the one before it (by sort_order) is completed
  sort_order int not null default 0
);
create index on estimate_line_items (estimate_id);

-- proposed_work now traces back to the estimate it came from
alter table proposed_work add column estimate_id uuid references estimates(id) on delete set null;
alter table proposed_work add column estimate_line_item_id uuid references estimate_line_items(id) on delete set null;
create index on proposed_work (estimate_line_item_id);

alter table estimates enable row level security;
alter table estimate_line_items enable row level security;

create policy "estimates_owner_full_access" on estimates
  for all using (is_owner()) with check (is_owner());

create policy "estimates_client_select" on estimates
  for select using (
    client_id in (select id from clients where client_user_id = auth.uid())
    and status in ('sent', 'accepted', 'declined')
  );

create policy "estimate_items_owner_full_access" on estimate_line_items
  for all using (is_owner()) with check (is_owner());

create policy "estimate_items_client_select" on estimate_line_items
  for select using (
    estimate_id in (
      select id from estimates
      where client_id in (select id from clients where client_user_id = auth.uid())
      and status in ('sent', 'accepted', 'declined')
    )
  );

create type market_role as enum ('buy', 'sell');

create table buy_sell_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  role market_role not null,
  details text,
  piano_id uuid references pianos(id) on delete set null, -- for sellers, link the instrument
  desired_piano_type text, -- for buyers: what they're looking for (grand/upright/digital/any)
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on buy_sell_entries (role, active);

-- ============================================================
-- ROW LEVEL SECURITY
-- This is the real access boundary — enforced by Postgres itself,
-- not by your app code. Even if a bug in the frontend leaked a
-- client's ID, the database still won't return rows they don't own.
-- ============================================================
alter table clients enable row level security;
alter table pianos enable row level security;
alter table service_records enable row level security;
alter table proposed_work enable row level security;
alter table buy_sell_entries enable row level security;
alter table availability_slots enable row level security;
-- (profiles was already enabled right after its own CREATE TABLE above;
-- leads and estimates/estimate_line_items already had RLS enabled right
-- after their CREATE TABLE statements too)

-- clients: owner sees everyone; a client sees only their own row
create policy "clients_owner_full_access" on clients
  for all using (is_owner()) with check (is_owner());

create policy "clients_self_select" on clients
  for select using (client_user_id = auth.uid());

-- pianos: owner full access; client sees only pianos on their client record
create policy "pianos_owner_full_access" on pianos
  for all using (is_owner()) with check (is_owner());

create policy "pianos_self_select" on pianos
  for select using (
    client_id in (select id from clients where client_user_id = auth.uid())
  );

-- service_records: owner full access; client sees only their pianos' history
create policy "service_records_owner_full_access" on service_records
  for all using (is_owner()) with check (is_owner());

create policy "service_records_self_select" on service_records
  for select using (
    piano_id in (
      select p.id from pianos p
      join clients c on c.id = p.client_id
      where c.client_user_id = auth.uid()
    )
  );

-- proposed_work: owner full access; client can select their own.
-- Deliberately NO client update policy — scheduling only happens through
-- book_slot() (security definer, below), which bypasses RLS internally
-- and does its own ownership + availability checks. An earlier version of
-- this schema had a direct client UPDATE policy here that let a client set
-- status='scheduled' with any scheduled_at value directly, with no actual
-- slot ever being reserved — that policy is intentionally gone.
create policy "proposed_work_owner_full_access" on proposed_work
  for all using (is_owner()) with check (is_owner());

create policy "proposed_work_self_select" on proposed_work
  for select using (
    client_id in (select id from clients where client_user_id = auth.uid())
  );

-- buy_sell_entries: owner full access; client sees + manages only their own entries
create policy "buysell_owner_full_access" on buy_sell_entries
  for all using (is_owner()) with check (is_owner());

create policy "buysell_self_all" on buy_sell_entries
  for all using (
    client_id in (select id from clients where client_user_id = auth.uid())
  )
  with check (
    client_id in (select id from clients where client_user_id = auth.uid())
  );

-- availability_slots: everyone authenticated can view open slots;
-- only the book_slot() function below (security definer) can book one,
-- so a client can't directly mark arbitrary slots as booked or edit them.
create policy "slots_select_all" on availability_slots
  for select using (auth.uid() is not null);

create policy "slots_owner_write" on availability_slots
  for all using (is_owner()) with check (is_owner());

-- ============================================================
-- DOCUMENTS
-- The foundation for consolidating scattered records (photos, notes,
-- old invoices, voice memo transcripts, whatever) into one searchable
-- place, optionally linked to a client or piano. This stores files and
-- whatever metadata you provide about them — it does NOT automatically
-- extract EXIF data, transcribe audio, or parse emails/calendars. That's
-- a genuinely separate, larger project (see README) built on top of this
-- foundation once it exists, not bundled into it upfront.
-- ============================================================
create type document_source as enum (
  'upload', 'gazelle_import', 'email', 'calendar', 'photo', 'voice_memo', 'video', 'manual_note'
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  piano_id uuid references pianos(id) on delete set null,
  title text not null,
  description text,
  source document_source not null default 'upload',
  original_filename text,
  storage_path text, -- path within the 'documents' Supabase Storage bucket; null for a text-only note
  captured_at date,  -- when the ORIGINAL artifact was created (photo taken, invoice dated) — distinct
                      -- from created_at (when it was imported into this system), since those are
                      -- often months or years apart for older records
  tags text[],
  created_at timestamptz not null default now()
);
create index on documents (client_id);
create index on documents (piano_id);
create index on documents using gin (tags);

alter table documents enable row level security;

-- Owner-only. These are internal business records, not something a client
-- should ever see through their portal, unlike everything else that has a
-- client-facing counterpart.
create policy "documents_owner_full_access" on documents
  for all using (is_owner()) with check (is_owner());

-- ============================================================
-- STORAGE
-- Run this once in the Supabase dashboard (Storage tab) or via the API:
-- create a bucket named 'documents', set to private (not public). The
-- policies below then control who can read/write objects in it — mirrors
-- the is_owner() pattern used everywhere else, so only the owner's
-- session can upload or download, and the anon key alone grants nothing.
-- ============================================================
create policy "documents_bucket_owner_read" on storage.objects
  for select using (bucket_id = 'documents' and is_owner());

create policy "documents_bucket_owner_write" on storage.objects
  for insert with check (bucket_id = 'documents' and is_owner());

create policy "documents_bucket_owner_delete" on storage.objects
  for delete using (bucket_id = 'documents' and is_owner());

-- ============================================================
-- COMPLETING WORK
-- Nothing before this point ever marked proposed_work as 'completed' or
-- updated a piano's last_service_date after the initial import — meaning
-- the reminder engine would have quietly gone stale forever, always
-- computing "due" from whatever date was last imported. This function is
-- the missing link: completing a job atomically updates the work status,
-- the piano's service history, AND logs a service_records row, so all
-- three can never drift out of sync with each other.
-- ============================================================
create or replace function complete_work(p_work_id uuid, p_performed_at date default current_date)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_piano_id uuid;
  v_description text;
  v_estimate_id uuid;
  v_remaining_open int;
begin
  -- Accepts both 'scheduled' (a visit happened) and 'in_progress' (a
  -- shop-only phase with no appointment) as valid starting states —
  -- those are the two paths a phase can take to get here.
  update proposed_work
  set status = 'completed', completed_at = p_performed_at
  where id = p_work_id and status in ('scheduled', 'in_progress')
  returning piano_id, description, estimate_id into v_piano_id, v_description, v_estimate_id;

  if v_piano_id is null then
    raise exception 'Work item not found or not in a completable status';
  end if;

  -- Always log what happened, regardless of whether the whole project is
  -- done — this is real service history either way.
  insert into service_records (piano_id, service_type, performed_at, summary)
  values (v_piano_id, 'service', p_performed_at, v_description);

  -- But only reset the piano's "last serviced" clock once every phase tied
  -- to the same estimate is resolved. Updating it on every intermediate
  -- phase of a multi-week rebuild would wrongly restart the reminder
  -- engine's 6-month countdown each time a sub-phase (say, restringing)
  -- wraps up, long before the piano is actually done and back in the home.
  -- A work item with no estimate_id (shouldn't normally happen, since
  -- everything flows through an estimate) is treated as standalone and
  -- always updates the date, matching the original single-visit behavior.
  if v_estimate_id is null then
    update pianos set last_service_date = p_performed_at where id = v_piano_id;
  else
    select count(*) into v_remaining_open
    from proposed_work
    where estimate_id = v_estimate_id and status not in ('completed', 'declined');

    if v_remaining_open = 0 then
      update pianos set last_service_date = p_performed_at where id = v_piano_id;
    end if;
  end if;
end;
$$;

-- ============================================================
-- ============================================================
-- BULK PRICE ADJUSTMENT
-- Multiplies every active price by (1 + percent/100), optionally scoped
-- to one category. One UPDATE statement regardless of row count — doing
-- this as hundreds of individual application-level updates would be slow
-- and risk a serverless function timeout at real catalog size (975+ rows
-- here already). This is exactly the tool for "these prices are 10 years
-- old and 40-60% below market" — pick your own percentage, apply it in
-- one action, rather than hand-editing every price.
-- ============================================================
create or replace function bulk_adjust_prices(p_percent numeric, p_category text default null)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_multiplier numeric;
  v_updated int;
begin
  v_multiplier := 1 + (p_percent / 100);
  if v_multiplier <= 0 then
    raise exception 'That percentage would make every price zero or negative';
  end if;

  update service_catalog_prices scp
  set price = round(price * v_multiplier, 2)
  from service_catalog sc
  where scp.service_catalog_id = sc.id
    and sc.active = true
    and (p_category is null or sc.category = p_category);

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- ============================================================
-- START PHASE
-- For shop-only phases (requires_scheduling = false): moves a phase from
-- 'proposed' to 'in_progress'. This is the owner-initiated equivalent of
-- book_slot() for phases that have no client appointment at all. Enforces
-- sequencing: if this phase's line item was marked depends_on_previous,
-- the immediately preceding line item (by sort_order, within the same
-- estimate) must already be completed.
-- ============================================================
create or replace function start_phase(p_work_id uuid, p_started_at timestamptz default now())
returns void
language plpgsql
set search_path = public
as $$
declare
  v_estimate_id uuid;
  v_depends_on_previous boolean;
  v_line_item_id uuid;
  v_sort_order int;
  v_prev_status work_status;
  v_updated_rows int;
begin
  select estimate_id, depends_on_previous, estimate_line_item_id
  into v_estimate_id, v_depends_on_previous, v_line_item_id
  from proposed_work
  where id = p_work_id and status = 'proposed' and requires_scheduling = false;

  if v_line_item_id is null and v_estimate_id is null then
    raise exception 'Work item not found, not a shop-only phase, or already started';
  end if;

  if v_depends_on_previous and v_line_item_id is not null then
    select sort_order into v_sort_order from estimate_line_items where id = v_line_item_id;

    select pw.status into v_prev_status
    from proposed_work pw
    join estimate_line_items eli on eli.id = pw.estimate_line_item_id
    where pw.estimate_id = v_estimate_id and eli.sort_order < v_sort_order
    order by eli.sort_order desc
    limit 1;

    if v_prev_status is not null and v_prev_status != 'completed' then
      raise exception 'The previous phase isn''t completed yet — this one depends on it finishing first';
    end if;
  end if;

  update proposed_work
  set status = 'in_progress', started_at = p_started_at
  where id = p_work_id and status = 'proposed'
  returning 1 into v_updated_rows;

  if v_updated_rows is null then
    raise exception 'Work item could not be started — it may have changed status already';
  end if;
end;
$$;

-- ============================================================
-- INVOICES
-- Created from a completed estimate's line items once its work is done.
-- Kept separate from estimates rather than relabeling an accepted estimate
-- as "the invoice," because a client might decline part of a quote, or
-- extra work found on-site might get billed separately — estimates and
-- invoices can legitimately diverge, and forcing them to be one record
-- would make that divergence awkward to represent.
--
-- Payment fields are named for Square (square_payment_link_id,
-- square_order_id) since that's the primary processor here.
-- ============================================================
create type invoice_status as enum ('draft', 'sent', 'paid', 'void');

create table invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  estimate_id uuid references estimates(id) on delete set null,
  status invoice_status not null default 'draft',
  due_date date,
  square_payment_link_id text,
  square_payment_link_url text,
  square_order_id text,
  sent_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index on invoices (client_id);
create index on invoices (square_order_id);

create table invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  amount numeric(10,2) not null,
  sort_order int not null default 0
);
create index on invoice_line_items (invoice_id);

alter table invoices enable row level security;
alter table invoice_line_items enable row level security;

create policy "invoices_owner_full_access" on invoices
  for all using (is_owner()) with check (is_owner());

-- Same pattern as estimates: a client can see it once it's actually been
-- sent, never while it's a draft.
create policy "invoices_client_select" on invoices
  for select using (
    client_id in (select id from clients where client_user_id = auth.uid())
    and status in ('sent', 'paid')
  );

create policy "invoice_items_owner_full_access" on invoice_line_items
  for all using (is_owner()) with check (is_owner());

create policy "invoice_items_client_select" on invoice_line_items
  for select using (
    invoice_id in (
      select id from invoices
      where client_id in (select id from clients where client_user_id = auth.uid())
      and status in ('sent', 'paid')
    )
  );

-- ============================================================
-- REMINDER ENGINE SUPPORT
-- Identifies pianos due for service based on last_service_date +
-- service_interval_months. No SECURITY DEFINER needed: called with
-- the service role (cron job) it sees everything as intended, since
-- the service role bypasses RLS; called with a regular user's anon/
-- authenticated key it would still respect RLS and return nothing
-- for a non-owner, which is the safe default either way.
-- ============================================================
create or replace function pianos_due_for_service()
returns table (
  piano_id uuid,
  client_id uuid,
  client_name text,
  client_email text,
  client_email_opt_out boolean,
  last_service_date date,
  days_overdue int
)
language sql stable
set search_path = public
as $$
  select
    p.id,
    p.client_id,
    c.name,
    c.email,
    c.email_opt_out,
    p.last_service_date,
    (current_date - (p.last_service_date + (p.service_interval_months || ' months')::interval)::date)::int
  from pianos p
  join clients c on c.id = p.client_id
  where c.active = true
    and p.last_service_date is not null
    and (p.last_service_date + (p.service_interval_months || ' months')::interval)::date <= current_date
    -- Exclude a piano with an active multi-phase project underway (a
    -- rebuild in progress, say) — a piano mid-teardown obviously isn't
    -- "due for tuning" in any actionable sense. Deliberately narrower
    -- than "has any pending work at all": a simple single-item routine
    -- tuning reminder sitting unscheduled (one line item, status
    -- 'proposed') should keep nudging every cooldown cycle exactly as
    -- before — that's the ordinary case this whole engine exists for,
    -- not something to suppress. What's excluded here is specifically a
    -- piano tied to an estimate with MORE than one line item (a project,
    -- not a single task) that still has unresolved work of any kind.
    and not exists (
      select 1
      from proposed_work pw
      where pw.piano_id = p.id
        and pw.status not in ('completed', 'declined')
        and pw.estimate_id in (
          select estimate_id from proposed_work
          where piano_id = p.id
          group by estimate_id
          having count(*) > 1
        )
    );
$$;
-- Note: pianos with no last_service_date on record are intentionally excluded —
-- there's no baseline to compute "due" from, so those need a manual look rather
-- than a guessed reminder.

-- Speeds up the reminder engine's "is there already an open estimate for this
-- piano" check, which used to run once per due piano (N+1) — now batched into
-- a single query (see app/api/cron/reminders/route.ts), and this index is what
-- makes that single query fast even as the estimates table grows.
create index on estimates (piano_id, status);

-- ============================================================
-- ACCEPT ESTIMATE
-- Claims an estimate and generates its proposed_work rows in a single
-- transaction. This used to be two separate JS-level calls (claim status,
-- then insert work) — fine for the "two concurrent accepts" race, but it
-- introduces a different problem: if the insert failed after the status
-- update already committed, the estimate would be permanently stuck
-- "accepted" with no actual work behind it, and nothing could retry it
-- (the claim check would refuse to touch an already-accepted estimate
-- again). Doing both in one function means an exception at any point
-- rolls back everything, including the status change — Postgres aborts
-- the whole function call on an unhandled exception.
-- No SECURITY DEFINER needed: both real callers (the owner, via the
-- existing "owner_full_access" policies, and the reminder cron, via the
-- service role) already have direct permission on every table this
-- touches.
-- ============================================================
create or replace function accept_estimate(p_estimate_id uuid)
returns table (client_id uuid, piano_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_client_id uuid;
  v_piano_id uuid;
  v_updated_rows int;
  v_work_rows int;
begin
  update estimates
  set status = 'accepted', responded_at = now()
  where id = p_estimate_id and status <> 'accepted'
  returning estimates.client_id, estimates.piano_id into v_client_id, v_piano_id;

  get diagnostics v_updated_rows = row_count;

  -- Distinguishing "no row matched" from "row matched but client_id is
  -- null" matters: the latter is a legitimate, fixable state (a lead-only
  -- estimate that hasn't been converted yet) and deserves a clear message
  -- pointing at the fix, not a generic "not found."
  if v_updated_rows = 0 then
    raise exception 'Estimate not found, already accepted, or you do not have permission to accept it';
  end if;

  if v_client_id is null then
    raise exception 'Estimate has no client attached — convert the lead first';
  end if;

  if v_piano_id is null then
    raise exception 'Estimate has no piano attached — proposed work needs to be tied to an instrument';
  end if;

  -- Every phase's line item carries through to its proposed_work row:
  -- requires_client_visit becomes requires_scheduling (whether it needs
  -- book_slot() or start_phase()), depends_on_previous is copied as-is for
  -- start_phase() to check later, and estimated_duration_days becomes a
  -- rough target_completion_date measured from today — informational only,
  -- not a hard commitment, since phases before this one may run long.
  insert into proposed_work (
    piano_id, client_id, description, location_type, estimate_id,
    estimate_line_item_id, requires_scheduling, depends_on_previous,
    target_completion_date, status
  )
  select
    v_piano_id, v_client_id, eli.description, eli.location_type, p_estimate_id,
    eli.id, eli.requires_client_visit, eli.depends_on_previous,
    case when eli.estimated_duration_days is not null
      then (current_date + (eli.estimated_duration_days || ' days')::interval)::date
      else null
    end,
    'proposed'
  from estimate_line_items eli
  where eli.estimate_id = p_estimate_id;

  get diagnostics v_work_rows = row_count;

  if v_work_rows = 0 then
    raise exception 'Estimate has no line items to turn into proposed work';
  end if;

  return query select v_client_id, v_piano_id;
end;
$$;

-- ============================================================
-- BOOKING FUNCTION
-- Runs as the function owner (security definer), so it can update
-- both proposed_work and availability_slots atomically, but it does
-- its own checks first: the caller must own the proposed_work row,
-- and the slot must still be open. This is what the self-schedule
-- API route calls — never expose broader write access than this.
-- ============================================================
create or replace function book_slot(p_work_id uuid, p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_work_location location_type;
  v_slot_time timestamptz;
  v_slot_location location_type;
begin
  -- Ownership is folded into this same WHERE clause rather than checked in
  -- a separate query afterward. Two sequential checks would return two
  -- distinguishable error messages ("doesn't exist" vs. "not yours"),
  -- letting a caller infer whether a work_id they don't own exists at all
  -- purely from which error came back. One check, one generic failure mode.
  select client_id, location_type into v_client_id, v_work_location
  from proposed_work
  where id = p_work_id
    and status = 'proposed'
    and client_id in (select id from clients where client_user_id = auth.uid())
  for update; -- without this lock, two concurrent calls for the same work
              -- item could both pass this check before either commits, each
              -- grab a different slot, and both mark this one item
              -- "scheduled" — burning two slots for a single appointment

  if v_client_id is null then
    raise exception 'Work item not found, already scheduled, or not yours to schedule';
  end if;

  select starts_at, location_type into v_slot_time, v_slot_location
  from availability_slots
  where id = p_slot_id and is_booked = false
  for update; -- lock the row so two clients can't grab it at once

  if v_slot_time is null then
    raise exception 'That slot is no longer available';
  end if;

  -- The real enforcement point: a shop rebuild can't be booked into a
  -- home-visit slot (or vice versa) even if something upstream — a UI
  -- bug, a hand-crafted request — tried to hand this function a mismatched
  -- slot id. This check is what actually prevents that, not the dropdown
  -- filtering in the portal.
  if v_slot_location != v_work_location then
    raise exception 'That slot is for a different type of appointment (% required)', v_work_location;
  end if;

  update availability_slots set is_booked = true where id = p_slot_id;

  update proposed_work
  set status = 'scheduled', scheduled_at = v_slot_time
  where id = p_work_id;
end;
$$;
