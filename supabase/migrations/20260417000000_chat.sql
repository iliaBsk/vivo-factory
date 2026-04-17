create table if not exists vivo_conversations (
  id uuid primary key default gen_random_uuid(),
  audience_id text not null references vivo_audiences(audience_id) on delete cascade,
  channel text not null,
  external_id text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vivo_conversations_audience_channel
  on vivo_conversations(audience_id, channel);

create table if not exists vivo_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references vivo_conversations(id) on delete cascade,
  audience_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  sender_id text,
  sender_name text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vivo_messages_conversation_created
  on vivo_messages(conversation_id, created_at);

create index if not exists vivo_messages_audience_created
  on vivo_messages(audience_id, created_at);
