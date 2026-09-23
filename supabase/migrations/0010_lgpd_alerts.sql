-- Atendia · avisos de plano e LGPD
-- Idempotente. (Se você chegou a rodar a antiga 0010_member_mfa, esta não conflita.)

alter table public.agencies
  add column if not exists trial_reminder_sent_at timestamptz,     -- "seu teste acaba em 3 dias" já enviado
  add column if not exists trial_expired_notified_at timestamptz,  -- "seu teste acabou" já enviado
  add column if not exists privacy_url text,                       -- política de privacidade da agência (link no chat)
  add column if not exists retention_months int
    check (retention_months is null or retention_months in (6, 12, 24)); -- apagar conversas e contatos mais antigos que isso

create index if not exists conversations_last_message_idx on public.conversations(last_message_at);
create index if not exists leads_created_idx on public.leads(created_at);

notify pgrst, 'reload schema';
