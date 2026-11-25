-- Elite 360: tabelas NOVAS para eventos de webhook, isoladas por dono (owner = auth.users.id).
-- Aditivo e retrocompatível: não altera nenhuma tabela existente. Execute uma vez no SQL Editor do Supabase.
-- RLS ativado sem políticas: somente a chave de serviço (servidor) acessa. O navegador nunca lê estas tabelas.

create table if not exists elite_wh_events (
  seq bigint generated always as identity primary key,
  owner uuid not null,
  canal text not null,
  tipo text not null default 'message',
  direcao text not null default 'in',
  nome text, contato text, texto text,
  ts timestamptz not null default now(),
  ext_id text,
  temperatura text,
  unique (owner, ext_id)
);
create index if not exists elite_wh_events_owner_seq on elite_wh_events (owner, seq);
create index if not exists elite_wh_events_owner_contato on elite_wh_events (owner, canal, contato, ts desc);

create table if not exists elite_wh_instances (
  owner uuid primary key,
  instance text not null,
  status text not null default 'desconectado',
  qr text,
  updated_at timestamptz default now()
);
create table if not exists elite_wh_settings (
  owner uuid primary key,
  manager_phone text,
  updated_at timestamptz default now()
);
create table if not exists elite_wh_ig_accounts (
  ig_id text primary key,
  owner uuid not null
);
create table if not exists elite_wh_alerts (
  owner uuid not null,
  chave text not null,
  created_at timestamptz default now(),
  primary key (owner, chave)
);

alter table elite_wh_events enable row level security;
alter table elite_wh_instances enable row level security;
alter table elite_wh_settings enable row level security;
alter table elite_wh_ig_accounts enable row level security;
alter table elite_wh_alerts enable row level security;
