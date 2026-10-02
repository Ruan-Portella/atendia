# Processo de incidente de segurança

Use este roteiro sempre que houver suspeita de que dados tratados pelo BoaVoz foram acessados,
alterados, vazados ou perdidos sem autorização. Exemplos: chave de API ou token exposto, acesso
estranho no registro de acessos, bug que mostrou conversa de um cliente para outro, aviso de um
pesquisador pelo canal de segurança (/seguranca) ou ordem da Meta por violação.

> Na dúvida, abra o registro. Registro aberto à toa custa nada; prazo perdido custa caro.
> Pontos marcados com **(advogado)** ainda dependem da revisão jurídica.

## Papéis

- **Responsável:** Ruan Portella (contato@boavoz.com). Decide contenção e comunicação.
- **Continuidade:** as duas pessoas da seção Continuidade da spec são avisadas em incidente
  de severidade alta. **(preencher nomes e contatos)**
- **Quem é quem nos dados (LGPD):**
  - dados das agências (conta, cobrança, equipe): o BoaVoz é **controlador**;
  - conversas, contatos e leads dos clientes das agências: o negócio atendido é o controlador,
    a agência é a operadora e o BoaVoz é **suboperador**. Quem comunica a ANPD e os titulares é
    o controlador; o BoaVoz avisa a agência e ajuda com as informações.

## 1. Detectar e registrar (na hora)

1. Backoffice → **Conformidade → Incidentes de segurança → Registrar**. Anote título, severidade,
   quando foi detectado e o que se sabe. **Nunca** cole dado pessoal no registro: use contagens
   e tipos ("12 conversas de 1 cliente, com telefone e texto").
2. Severidade:
   - **alta**: dado de conversa, contato ou credencial exposto a terceiros, ou acesso indevido
     confirmado;
   - **média**: exposição possível, ainda sem confirmação, ou dado só de configuração;
   - **baixa**: falha sem acesso a dado pessoal (ex.: segredo exposto e girado antes de uso).

## 2. Conter (minutos)

Ferramentas, da mais leve à mais forte:

- **Uma agência ou um canal:** Backoffice → Agências → a agência → Pausar a IA, ou Suspender
  canal (todos os canais ou um, de um chatbot ou de todos).
- **Toda a plataforma:** Backoffice → visão geral → chave geral da IA ou "Desligar o WhatsApp de
  todos" (nada entra nem sai pela Cloud API).
- **Credenciais:** gire o que pode ter vazado e atualize na Vercel (Production e Preview):
  - Supabase: `SUPABASE_SERVICE_ROLE_KEY` (Settings → API → gerar nova) e senha do banco
    (`DATABASE_URL`);
  - OpenAI: `OPENAI_API_KEY` e `OPENAI_ADMIN_KEY`;
  - Meta: `WHATSAPP_TOKEN` (usuário do sistema), `WHATSAPP_APP_SECRET` e
    `INSTAGRAM_APP_SECRET` (painel do app);
  - `WHATSAPP_TOKEN_KEY` (cifra dos tokens dos clientes) só com plano de recifrar: trocar a
    chave sem recifrar deixa todos os números e contas do Instagram sem acesso;
  - Stripe, Resend, `CRON_SECRET`.
- **Sessões:** no Supabase, Authentication → Users → encerrar as sessões da pessoa afetada.
- **Código:** na Vercel, volte a produção para o deploy anterior (Instant Rollback).

Anote cada ação no campo "Contenção e correção" do registro, com horário.

## 3. Avaliar (até 24 h)

Responda no registro:

- Que dados? (conversa, telefone, e-mail, credencial, cobrança, dado de saúde)
- De quem e quantos? (agências, negócios, contatos)
- Por quanto tempo ficou exposto, e há sinal de uso? (registro de acessos, logs da Vercel,
  auditoria)
- **Há risco ou dano relevante aos titulares?** Considere: dado sensível (saúde), de criança,
  financeiro, de autenticação, protegido por sigilo, ou em larga escala. Marque no registro.

Consultas úteis (SQL, banco de produção):

```sql
-- acessos ao painel de uma pessoa (IP completo, 6 meses)
select * from access_log where actor_id = '<id ou e-mail>' order by created_at desc limit 100;
-- o que foi feito numa agência (auditoria, 1 ano)
select created_at, actor_type, actor_id, action, target_type, target_id, after from audit_log
where agency_id = '<agência>' order by created_at desc limit 200;
```

## 4. Comunicar

- **Agências afetadas (BoaVoz como suboperador): em até 48 horas** da confirmação, por e-mail ao
  dono, com o que aconteceu, que dados, quantos contatos, o que já foi feito e o que o
  controlador (o negócio) precisa decidir. Marque "Agências avisadas" no registro.
  **(advogado: prazo de 48 h a fixar no acordo de tratamento de dados)**
- **ANPD e titulares (quando o BoaVoz é o controlador, e houver risco ou dano relevante): em
  até 3 dias úteis** do conhecimento, pelo formulário de comunicação de incidente da ANPD
  (gov.br), conforme o art. 48 da LGPD e a Resolução CD/ANPD nº 15/2024. Marque "ANPD avisada" no
  registro. **(advogado)**
- **Meta:** se o incidente envolve dados do WhatsApp ou do Instagram (dados da Plataforma),
  avise a Meta sem demora pelo canal de suporte do desenvolvedor, como pedem os Termos da
  Plataforma. **(advogado: confirmar prazo)**
- **Pesquisador que reportou:** confirme o recebimento em até 3 dias úteis e avise quando
  corrigir.

## 5. Corrigir e encerrar

1. Corrija a causa (PR com teste que reproduz o problema, quando der).
2. Confira que a contenção pode ser desfeita (religar IA ou canal, levantar suspensões).
3. No registro: o que foi feito, a causa e o que muda para não repetir; status **encerrado**.

O registro fica guardado por **5 anos** (Resolução CD/ANPD nº 15/2024), mesmo os incidentes
sem comunicação, com a justificativa de não ter comunicado.

## Onde ficam os registros

| O quê | Onde | Quanto tempo |
| --- | --- | --- |
| Incidentes | `security_incidents` (Backoffice → Conformidade) | 5 anos |
| Auditoria (quem fez o quê, sem conteúdo de conversa) | `audit_log`, só inserção | 1 ano |
| Acessos ao painel, à área do cliente e ao backoffice (IP completo) | `access_log`, só inserção | 6 meses (Marco Civil, art. 15) |
| IP dos visitantes do chat do site (sob sigilo, só com ordem judicial) | `widget_access_log`, só inserção | 6 meses |
| Acessos ao backoffice (páginas abertas) | `admin_access_log` | sem prazo definido |

Auditoria e registros de acesso só aceitam inserção: o papel da aplicação não tem UPDATE,
DELETE nem TRUNCATE, e um gatilho recusa alteração. A única remoção é a rotina diária
(`purge_logs`), que apaga só o que venceu. Quem tem a credencial de dono do banco consegue
desligar o gatilho: por isso `DATABASE_URL` e a service role ficam marcadas como Sensitive na
Vercel.
