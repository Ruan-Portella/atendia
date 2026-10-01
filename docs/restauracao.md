# Roteiro de restauração de backup

Use este roteiro sempre que for preciso voltar o banco de produção para um backup do Supabase.
O objetivo é recuperar os dados **sem trazer de volta o que foi apagado a pedido**: exclusões
pela Meta (callback de exclusão de dados), pelo painel (conversa, contato LGPD, chatbot,
cliente) e opt-outs (SAIR, PARAR, STOP).

> Até a migração para o Supabase Pro (5 clientes pagantes), o plano Free **não tem backup
> diário**. Uma perda de dados não tem volta (risco aceito). Depois da migração, os backups
> expiram em até 7 dias e uma restauração perde até 24 horas de dados.

## O que protege

- **`deletion_log`**: tudo o que foi apagado por pedido (só a tabela, o id e a data, sem
  conteúdo), guardado 60 dias. `select reapply_deletions();` apaga tudo de novo e pode rodar
  mais de uma vez sem efeito extra.
- **`suppressions`**: quem pediu para não receber mensagens. Só hash, guardada 5 anos.
- **`deletion_requests`**: pedidos de exclusão da Meta e o andamento (página de status).

## Caminho preferido: restaurar num projeto novo

1. No Supabase, restaure o backup **num projeto novo**. O banco atual continua no ar e é a
   fonte do que mudou depois do backup.
2. No banco **atual**, exporte o que foi gravado depois do horário do backup:
   ```sql
   -- troque o horário pelo do backup (UTC)
   copy (select * from deletion_log where created_at > '2026-10-01 03:00') to stdout with csv header;
   copy (select * from suppressions where created_at > '2026-10-01 03:00' or revoked_at > '2026-10-01 03:00') to stdout with csv header;
   copy (select * from deletion_requests where created_at > '2026-10-01 03:00') to stdout with csv header;
   ```
   (No SQL Editor, rode os `select` e exporte o resultado em CSV.)
3. No banco **novo**, importe os três CSVs nas mesmas tabelas (Table Editor › Import data from
   CSV). Linhas de `suppressions` que já existem: atualize `revoked_at` e `revoke_source`.
4. No banco novo, rode `select reapply_deletions();`. O número devolvido é quantas linhas
   apagadas tinham voltado com o backup.
5. Aponte a Vercel para o projeto novo (`NEXT_PUBLIC_SUPABASE_URL`, as chaves e
   `DATABASE_URL`) e faça o redeploy.
6. Confira o `/api/health` e mande uma mensagem de teste no WhatsApp e no Instagram.

## Se for preciso restaurar por cima do banco atual

1. **Pause o agendador e a fila**: na Vercel, desligue os crons (Settings › Cron Jobs) e, se der,
   pause os webhooks da Meta. Mensagens que chegarem nesse meio-tempo a Meta reenvia (WhatsApp
   por até 7 dias; o Instagram descarta depois de 36 horas).
2. **Antes de restaurar**, exporte do banco atual o `deletion_log`, as `suppressions` e os
   `deletion_requests` (inteiros: são pequenos), como no passo 2 acima.
3. Restaure o backup.
4. Importe de volta os três CSVs (o que já existir fica igual).
5. Rode `select reapply_deletions();`.
6. Religue os crons e os webhooks, confira o `/api/health` e teste os canais.

## Depois

- Anote no documento do produto a data, o motivo, o horário do backup usado e o resultado do
  `reapply_deletions()`.
- Avise as agências afetadas se houve perda de dados entre o backup e a falha.
