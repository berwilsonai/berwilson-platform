-- Email integration tables for Microsoft Graph webhook pipeline
-- Phase 2: Intelligence Ingestion

-- Store OAuth tokens for Microsoft Graph API access
create table email_tokens (
  id uuid default gen_random_uuid() primary key,
  email_address text not null unique,
  access_token text not null,
  refresh_token text not null,
  token_type text default 'Bearer',
  expires_at timestamptz not null,
  scopes text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Store Microsoft Graph webhook subscription metadata
create table graph_subscriptions (
  id uuid default gen_random_uuid() primary key,
  subscription_id text not null unique,       -- Graph API subscription ID
  resource text not null,                      -- e.g. /users/{email}/mailFolders/inbox/messages
  change_type text not null default 'created', -- created, updated, deleted
  notification_url text not null,
  expiration_date_time timestamptz not null,
  client_state text not null,                  -- secret for validation
  email_address text not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Track processed email message IDs for idempotency
create table processed_emails (
  id uuid default gen_random_uuid() primary key,
  internet_message_id text not null unique,    -- RFC 2822 Message-ID
  graph_message_id text not null,              -- Microsoft Graph message ID
  email_address text not null,
  subject text,
  sender_email text,
  processed_at timestamptz default now(),
  update_id uuid references updates(id) on delete set null,
  status text default 'processed'              -- processed, failed, skipped
);

-- Indexes
create index idx_email_tokens_email on email_tokens(email_address);
create index idx_graph_subs_active on graph_subscriptions(is_active) where is_active = true;
create index idx_graph_subs_expiration on graph_subscriptions(expiration_date_time);
create index idx_processed_emails_internet_id on processed_emails(internet_message_id);
create index idx_processed_emails_graph_id on processed_emails(graph_message_id);

-- RLS
alter table email_tokens enable row level security;
create policy "email_tokens_select" on email_tokens for select using (auth.role() = 'authenticated');
create policy "email_tokens_insert" on email_tokens for insert with check (auth.role() = 'authenticated');
create policy "email_tokens_update" on email_tokens for update using (auth.role() = 'authenticated');

alter table graph_subscriptions enable row level security;
create policy "graph_subs_select" on graph_subscriptions for select using (auth.role() = 'authenticated');
create policy "graph_subs_insert" on graph_subscriptions for insert with check (auth.role() = 'authenticated');
create policy "graph_subs_update" on graph_subscriptions for update using (auth.role() = 'authenticated');

alter table processed_emails enable row level security;
create policy "processed_emails_select" on processed_emails for select using (auth.role() = 'authenticated');
create policy "processed_emails_insert" on processed_emails for insert with check (auth.role() = 'authenticated');
create policy "processed_emails_update" on processed_emails for update using (auth.role() = 'authenticated');

-- updated_at triggers
create trigger set_updated_at before update on email_tokens for each row execute function update_updated_at();
create trigger set_updated_at before update on graph_subscriptions for each row execute function update_updated_at();
