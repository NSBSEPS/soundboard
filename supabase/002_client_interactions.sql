-- ============================================================
-- CLIENT INTERACTIONS + CLIENT TIMELINE
-- client_interactions holds what no other table records: calls, notes,
-- in-person conversations, and email activity (reminder sent, opened,
-- bounced, spam complaint, unsubscribed). Everything else a client
-- timeline needs (service, appointments, estimates, invoices, documents,
-- measurements) already lives in its own table and is merged in by the
-- client_timeline view below — nothing is duplicated.
-- Owner-only. Webhook/cron/unsubscribe writes use the service role.
-- Must run AFTER clients, pianos, prospects, service_records,
-- proposed_work, estimates(+line items), invoices, documents and
-- piano_measurements exist (all earlier in schema.sql / 001).
-- ============================================================
create type interaction_type as enum (
  'note', 'call', 'text', 'email', 'in_person',
  'reminder_sent', 'email_opened', 'email_bounced', 'email_complained',
  'unsubscribed', 'other'
);
create type interaction_direction as enum ('inbound', 'outbound', 'internal');

alter table clients add column email_opt_out_at timestamptz;
alter table clients add column email_opt_out_reason text; -- 'unsubscribe_link' | 'spam_complaint' | 'hard_bounce' | 'manual'

create table client_interactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  piano_id uuid references pianos(id) on delete set null,
  prospect_id uuid references prospects(id) on delete set null, -- lets a converted prospect's notes follow them
  type interaction_type not null,
  direction interaction_direction not null default 'internal',
  occurred_at timestamptz not null default now(),
  summary text not null,
  details text,
  follow_up_date date,
  follow_up_done boolean not null default false,
  is_automated boolean not null default false, -- system-written rows can't be deleted from the UI
  resend_email_id text,                        -- links email events back to the message that caused them
  created_at timestamptz not null default now(),
  -- One row per (email, event type): a re-delivered webhook or a second
  -- open of the same message can never create a duplicate timeline entry.
  -- NULL email ids (manual notes) are distinct, so they're unaffected.
  constraint client_interactions_email_event_unique unique (resend_email_id, type)
);
create index on client_interactions (client_id, occurred_at desc);
create index on client_interactions (follow_up_date)
  where follow_up_date is not null and follow_up_done = false;

alter table client_interactions enable row level security;

create policy "client_interactions_owner_full_access" on client_interactions
  for all using (is_owner()) with check (is_owner());

-- security_invoker: the view runs with the CALLER's permissions, so the
-- underlying tables' RLS still applies (requires Postgres 15+, which
-- Supabase projects use). Without it the view would run as its owner and
-- bypass RLS for anyone who can select from it.
create view client_timeline with (security_invoker = true) as
  select i.client_id, i.piano_id, i.occurred_at,
         i.type::text as kind, i.summary as title, i.details as detail,
         'client_interactions'::text as source_table, i.id as source_id
  from client_interactions i
union all
  select p.client_id, sr.piano_id, sr.performed_at::timestamptz,
         'service', coalesce(sr.summary, sr.service_type), null::text,
         'service_records', sr.id
  from service_records sr join pianos p on p.id = sr.piano_id
union all
  select pw.client_id, pw.piano_id, pw.scheduled_at,
         'appointment', pw.description, null::text,
         'proposed_work', pw.id
  from proposed_work pw where pw.scheduled_at is not null
union all
  select pw.client_id, pw.piano_id, pw.completed_at::timestamptz,
         'work_completed', pw.description, null::text,
         'proposed_work', pw.id
  from proposed_work pw where pw.completed_at is not null
union all
  select e.client_id, e.piano_id, e.sent_at,
         'estimate_sent', 'Estimate sent',
         '$' || to_char(coalesce((select sum(li.amount) from estimate_line_items li where li.estimate_id = e.id), 0), 'FM999,990.00'),
         'estimates', e.id
  from estimates e where e.client_id is not null and e.sent_at is not null
union all
  select e.client_id, e.piano_id, e.responded_at,
         'estimate_' || e.status::text, 'Estimate ' || e.status::text,
         '$' || to_char(coalesce((select sum(li.amount) from estimate_line_items li where li.estimate_id = e.id), 0), 'FM999,990.00'),
         'estimates', e.id
  from estimates e
  where e.client_id is not null and e.responded_at is not null and e.status in ('accepted', 'declined')
union all
  select inv.client_id, null::uuid, inv.sent_at,
         'invoice_sent', 'Invoice sent',
         '$' || to_char(coalesce((select sum(li.amount) from invoice_line_items li where li.invoice_id = inv.id), 0), 'FM999,990.00'),
         'invoices', inv.id
  from invoices inv where inv.sent_at is not null
union all
  select inv.client_id, null::uuid, inv.paid_at,
         'invoice_paid', 'Invoice paid',
         '$' || to_char(coalesce((select sum(li.amount) from invoice_line_items li where li.invoice_id = inv.id), 0), 'FM999,990.00'),
         'invoices', inv.id
  from invoices inv where inv.paid_at is not null
union all
  select d.client_id, d.piano_id, coalesce(d.captured_at::timestamptz, d.created_at),
         'document', d.title, d.description,
         'documents', d.id
  from documents d where d.client_id is not null
union all
  select p.client_id, m.piano_id, m.measured_at::timestamptz,
         'measurement', 'Piano measurements recorded', m.notes,
         'piano_measurements', m.id
  from piano_measurements m join pianos p on p.id = m.piano_id;

-- Defense in depth: the anon (logged-out) role never needs this view.
revoke all on client_timeline from anon;
