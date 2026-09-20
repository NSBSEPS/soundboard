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
  category text not null, -- 'rebuilding' | 'regulation' | 'repair' | 'voicing' | 'tuning'
  name text not null,
  default_price numeric(10,2), -- your standard price for this task. Null until you set one;
                                 -- once set, it autofills every time and stays current until
                                 -- you deliberately change it — this is the actual fix for
                                 -- having to retype the same price on every estimate.
  default_location_type location_type not null default 'in_home',
  default_requires_client_visit boolean not null default true,
  default_depends_on_previous boolean not null default false,
  typical_duration_days int, -- rough guide for shop-only phases, not enforced
  sort_order int not null default 0,
  active boolean not null default true
);
create index on service_catalog (category, sort_order);

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

  -- REGULATION — standard grand action sequence (order matters technically,
  -- though these are typically billed together as one visit rather than
  -- as dependent phases, hence depends_on_previous=false by default).
  ('regulation', 'Key leveling (balance rail & front rail)', 'in_home', true, false, null, 10),
  ('regulation', 'Key squaring & spacing', 'in_home', true, false, null, 20),
  ('regulation', 'Hammer blow distance adjustment', 'in_home', true, false, null, 30),
  ('regulation', 'Let-off adjustment', 'in_home', true, false, null, 40),
  ('regulation', 'Drop adjustment', 'in_home', true, false, null, 50),
  ('regulation', 'Key dip adjustment', 'in_home', true, false, null, 60),
  ('regulation', 'Aftertouch adjustment', 'in_home', true, false, null, 70),
  ('regulation', 'Backcheck distance adjustment', 'in_home', true, false, null, 80),
  ('regulation', 'Repetition spring tension adjustment', 'in_home', true, false, null, 90),
  ('regulation', 'Jack-to-knuckle position adjustment', 'in_home', true, false, null, 100),
  ('regulation', 'Damper timing & lift adjustment', 'in_home', true, false, null, 110),
  ('regulation', 'Pedal regulation (sustain, una corda, sostenuto)', 'in_home', true, false, null, 120),

  -- REPAIR — common single-visit fixes.
  ('repair', 'Sticking key repair', 'in_home', true, false, null, 10),
  ('repair', 'Broken string replacement', 'in_home', true, false, null, 20),
  ('repair', 'Broken hammer or shank repair/replacement', 'in_home', true, false, null, 30),
  ('repair', 'Damper felt replacement or resurfacing', 'in_home', true, false, null, 40),
  ('repair', 'Pedal squeak/adjustment repair', 'in_home', true, false, null, 50),
  ('repair', 'Key top replacement/recovering', 'in_home', true, false, null, 60),
  ('repair', 'Loose tuning pin repair', 'in_home', true, false, null, 70),
  ('repair', 'Minor soundboard crack repair', 'in_home', true, false, null, 80),
  ('repair', 'Minor bridge crack/cap repair', 'in_home', true, false, null, 90),
  ('repair', 'Buzz diagnosis & repair', 'in_home', true, false, null, 100),
  ('repair', 'Case hardware repair (hinge, lid prop, caster)', 'in_home', true, false, null, 110),

  -- VOICING
  ('voicing', 'Tone evaluation', 'in_home', true, false, null, 10),
  ('voicing', 'Hammer filing & reshaping', 'in_home', true, false, null, 20),
  ('voicing', 'Needle voicing (softening)', 'in_home', true, true, null, 30),
  ('voicing', 'Hardening treatment (lacquer/chemical)', 'in_home', true, false, null, 40),
  ('voicing', 'String leveling for unison strike', 'in_home', true, false, null, 50),
  ('voicing', 'Final voicing pass after tuning', 'in_home', true, true, null, 60),

  -- TUNING
  ('tuning', 'Standard pitch tuning', 'in_home', true, false, null, 10),
  ('tuning', 'Pitch raise (two-pass)', 'in_home', true, false, null, 20),
  ('tuning', 'Concert/performance tuning', 'in_home', true, false, null, 30);

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
