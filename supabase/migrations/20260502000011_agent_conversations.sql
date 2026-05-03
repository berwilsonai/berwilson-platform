-- Agent conversation storage
create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid references public.projects(id) on delete cascade,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null,
  tool_calls jsonb,
  tool_results jsonb,
  model_used text,
  tokens_in int,
  tokens_out int,
  latency_ms int,
  created_at timestamptz default now()
);

create index idx_agent_conversations_user on public.agent_conversations(user_id);
create index idx_agent_conversations_project on public.agent_conversations(project_id);
create index idx_agent_messages_conversation on public.agent_messages(conversation_id, created_at);

-- RLS
alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;

create policy "Users see own conversations" on public.agent_conversations
  for all using (auth.uid() = user_id);

create policy "Users see own messages" on public.agent_messages
  for all using (
    conversation_id in (
      select id from public.agent_conversations where user_id = auth.uid()
    )
  );
