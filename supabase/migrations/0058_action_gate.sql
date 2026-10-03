-- Boavoz · mapa de ids da conversa (P1): {identificador → categoria, rótulo} dos objetos com item
-- regulamentado ou proibido (e do objeto que os contém) vistos no retorno das ações. Vale 24
-- horas; base do portão de parâmetros das ações de pedido (C pública). Sem cifra até a leva S.
-- Ver src/lib/action-gate.ts. Idempotente.
alter table public.conversations add column if not exists gate_id_map_enc text;
alter table public.conversations add column if not exists gate_id_map_expires_at timestamptz;

notify pgrst, 'reload schema';
