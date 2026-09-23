# Atendia

Plataforma white-label de chatbots de IA para agências e freelancers. A agência cola o site de um cliente, recebe um assistente treinado nele, coloca a própria marca e revende por assinatura. A Atendia nunca aparece para o cliente final.

Stack: **Next.js 16 (App Router)** na Vercel · **Supabase** (Auth, Postgres + pgvector, Storage) · **Vercel AI SDK** com **OpenAI ou Anthropic** · **Stripe** (opcional) · Tailwind v4.

## O que está pronto (V1)

- Landing page com gerador de demo público, calculadora de retorno, preços e afiliados.
- Cadastro/login por e-mail + senha e Google (Supabase Auth). A agência é criada no primeiro acesso.
- Painel por cliente: a agência tem clientes, cada um com vários chatbots. Lista de clientes com KPIs (conversas, leads, % resolvidas, faturamento informado) e um painel por cliente com chatbots, leads, conversas, relatório e dados.
- Relatório mensal e portal do cliente final: link somente leitura (`/c/[token]`) com a marca da agência, números do mês, gráfico por dia, contatos e conversas; e-mail automático todo dia 1º (Vercel Cron) e "Salvar em PDF".
- Área do cliente (`/cliente`): as pessoas do cliente final (quantos e-mails quiser) entram por link mágico, sem senha, com a marca da agência. A agência libera por cliente: **atender conversas** (assumir, responder, devolver) e/ou **ensinar o assistente** (responder perguntas sem resposta, criar e editar textos e FAQs; site e PDF ficam com a agência). Só vale sessão aberta por link mágico, e tudo fica assinado (quem respondeu, quem editou).
- Atendimento humano: o assistente chama a equipe quando o visitante pede uma pessoa (e-mail na hora); no painel você assume a conversa, responde e o visitante vê no widget em segundos; ao devolver, o assistente continua sabendo o que você disse.
- Editor do chatbot: base de conhecimento (site inteiro, página, PDF, texto, FAQ), personalidade, aparência e marca, captura de leads, conversas, instalação, teste ao vivo. Perguntas que o bot não soube responder aparecem com "Responder": a resposta vira FAQ e é indexada na hora. Sites e páginas são relidos toda semana (sem custo se nada mudou).
- Gerador de demo: cria bot + rastreia o site + embeddings em um passo; página `/demo/[slug]` com a marca da agência e contador de aberturas; botão de WhatsApp para mandar o link.
- Chat com RAG (pgvector), streaming, ferramentas para registrar lead e pergunta sem resposta, cota mensal por plano, memória de conversa por visitante.
- Widget: `<script src=".../widget.js" data-key="…">` abre o chat em iframe (`/w/[key]`), funciona em qualquer site. Cor, canto da tela e distância da borda vêm da aba Aparência via `/api/widget/config` (cache de 60 s) e valem na hora nos sites instalados; `data-color` / `data-position` / `data-offset` no script sobrepõem por site. Chave por `?key=` (para `next/script` e tag managers); expõe `window.ChatWidget.open()/close()/toggle()`. Nomes genéricos: nada da plataforma aparece no código do cliente.
- Aba Instalação com passo a passo por plataforma (WordPress, Webflow, Framer, Wix, Shopify, GTM, HTML, Next.js App/Pages Router, React, Vue/Nuxt, Angular, link direto), snippets prontos com a chave do bot e cartão "Instalado em dominio.com.br" preenchido pelo ping do widget.
- Afiliados: link `?ref=`, cookie de 30 dias, 30% do valor pago pela indicada (calculado no `invoice.paid`) vira crédito. A agência converte o saldo em desconto com um clique: vira *customer balance* no Stripe e é abatido automaticamente das próximas faturas (sem cupom, sem PIX). Constantes em `src/lib/referral-credit.ts` (taxa e mínimo de R$ 10).
- Stripe: checkout, portal e webhook (plano da agência, comissões). Sem chave, tudo fica em teste.
- E-mail de lead novo via Resend (opcional).
- Domínio próprio por agência (planos Agência e Escala): demos, portal e widget em `chat.agencia.com.br`, com instrução de DNS, verificação e integração opcional com a API de domínios da Vercel.
- Limites nas rotas públicas (demo, chat, formulário de lead) guardados no próprio Postgres, com IP em hash.
- Testes (`npm test`, Vitest) e CI no GitHub Actions (lint, tipos e testes).

## Configurar em 15 minutos

### 1. Supabase

1. Crie um projeto em supabase.com (plano free serve).
2. **Migrações** (tudo em `supabase/migrations`, em ordem; todas podem rodar de novo sem estragar nada):
   - **Automático (recomendado):** defina `DATABASE_URL` na Vercel (Supabase → Connect → *Session pooler*, porta 5432). Todo deploy de produção aplica as migrações novas **antes** do build (`scripts/migrate.mjs`); se uma falhar, o deploy falha e o código novo não vai ao ar. Localmente: `npm run migrate`.
   - **Manual:** no **SQL Editor**, rode cada arquivo em ordem: `0001_init` (tabelas, pgvector, RLS, buckets, agência vitrine), `0002_install_ping`, `0003_referral_credit`, `0004_clients` (clientes com vários chatbots), `0005_rate_limit`, `0006_portal_handoff` (portal do cliente, relatório, atendimento humano), `0007_source_refresh`, `0008_custom_domain`, `0009_client_access` (área do cliente).
3. **Authentication → Providers**: deixe Email ligado (pode desligar "Confirm email" no começo para agilizar) e ative **Google** (Client ID/Secret do Google Cloud Console; a redirect URL está na tela do Supabase).
4. **Authentication → URL Configuration**: Site URL = `http://localhost:3000` (depois o domínio da Vercel); Redirect URLs: `http://localhost:3000/auth/callback` e `https://SEU-DOMINIO/auth/callback`.
5. **Project Settings → API**: copie `Project URL`, `anon key` e `service_role key`.

### 2. IA: OpenAI ou Anthropic

O chat pode responder com **OpenAI** (padrão, `gpt-4o-mini`) ou com **Anthropic** (`AI_PROVIDER=anthropic`, modelo em `ANTHROPIC_MODEL`, padrão `claude-haiku-4-5`; troque para `claude-sonnet-4-5` se quiser respostas melhores em português por um custo maior).

A busca na base de conhecimento usa **embeddings**, e a Anthropic não oferece esse modelo. Escolha um dos dois (`EMBEDDING_PROVIDER`, ou deixe vazio para usar a chave que existir):

- `openai` → `OPENAI_API_KEY` com `text-embedding-3-small` (centavos por site indexado);
- `google` → `GOOGLE_API_KEY` do [Google AI Studio](https://aistudio.google.com/apikey) com `gemini-embedding-001`, que tem cota gratuita. É a opção para quem usa Claude e não quer conta na OpenAI.

Os dois geram vetores de 1536 dimensões; não misture provedores depois de indexar (se trocar, reprocesse as fontes).

Custo aproximado por conversa: R$ 0,01 a 0,03 com gpt-4o-mini ou Claude Haiku; 3 a 5 vezes isso com Claude Sonnet.

### 3. Local

```bash
cp .env.example .env.local   # preencha Supabase + OpenAI
npm install
npm run dev                  # http://localhost:3000
```

Crie sua conta em `/cadastro`, vá em **Demos**, cole o site de qualquer empresa e teste.

### 4. Vercel

Importe o repositório, cole as mesmas variáveis do `.env.local` (mude `NEXT_PUBLIC_APP_URL` para o domínio final) e faça o deploy. Rotas de ingestão têm `maxDuration = 60`; no plano Hobby o limite é 60 s com Fluid Compute, suficiente para sites de até ~40 páginas. Sites maiores: reduza `CRAWL_MAX_PAGES` ou suba para o Pro.

Variáveis extras para produção (detalhes em `.env.example`):

- `DATABASE_URL`: aplica as migrações automaticamente em cada deploy de produção.
- `CRON_SECRET`: liga os crons de `vercel.json` (relatório mensal nos dias 1–3, releitura diária dos sites com mais de 7 dias).
- `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` (opcional): o painel adiciona o domínio próprio da agência no projeto sozinho. Sem eles, adicione o domínio em Project → Settings → Domains.

> Vercel Hobby não permite uso comercial. Quando começar a cobrar, use o plano Pro ou hospede em Cloudflare Pages/Railway.

### 5. Stripe (quando for cobrar)

1. Crie 3 produtos com preço recorrente mensal em BRL (Freelancer 99, Agência 249, Escala 599) e copie os `price_…` para o `.env`.
2. Webhook apontando para `https://SEU-DOMINIO/api/stripe/webhook` com os eventos `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`. Copie o `whsec_…`.
3. Ative o portal do cliente em Settings → Billing → Customer portal.

### 6. Resend (opcional)

Chave em resend.com e um domínio verificado para `EMAIL_FROM`. Sem isso, leads ficam só no painel.

## Estrutura

```
supabase/migrations/0001_init.sql   esquema completo (tabelas, pgvector, RLS, funções, buckets)
src/proxy.ts                        sessão do Supabase + proteção de /painel + cookie de afiliado
src/lib/
  supabase/{server,client,admin}.ts clientes (RLS do usuário / navegador / service role)
  agency.ts                         agência do usuário logado (cria no 1º acesso, aplica ?ref=)
  ai.ts                             modelos, embeddings, prompt de sistema
  ingest.ts                         crawler, extração de PDF, chunking, embeddings
  chat.ts                           RAG + streamText + ferramentas (lead, pergunta sem resposta)
  notify.ts                         e-mail de lead (Resend)
  plans.ts · stripe.ts · utils.ts
src/app/
  page.tsx                          landing
  login · cadastro · auth/*         autenticação
  painel/                           layout com sidebar, lista, bots/[id] (editor), demos, leads, clientes, marca, afiliados, cobranca
  painel/afiliados/actions.ts       redeemCredit (crédito de indicação → customer balance no Stripe)
  painel/actions.ts                 server actions (criar/editar bot, converter demo, marca)
  demo/[slug]                       página pública da demo (white-label)
  w/[key]                           conteúdo do widget (iframe) e link direto
  api/chat · api/demo · api/leads (+ /export CSV) · api/bots/[id]/sources (POST cria, PUT edita/reprocessa, DELETE) · api/widget/ping · api/widget/config · api/stripe/*
src/components/install-guide.tsx   guia de instalação por plataforma (aba Instalação)
src/components/ui/                  modal (<dialog> nativo), toast, menu de ações, ActionForm (server action + toast), SubmitButton, ConfirmAction
public/widget.js                    loader do widget (botão flutuante + iframe + API window.ChatWidget + ping de instalação)
```

## Limites conhecidos da V1 (e o que fazer depois)

- **Sites que dependem de JavaScript** para renderizar conteúdo não são lidos (o crawler baixa o HTML). Solução: adicionar o texto manualmente ou, na V2, usar um serviço de render.
- **Ingestão síncrona**: sites muito grandes podem passar do timeout da função. V2: fila (Supabase Queues ou Inngest) e status "treinando" com polling.
- **Demos anônimas** da landing ficam na agência vitrine para sempre. Crie um cron (Supabase → Cron) apagando `bots` com `is_demo = true` e `agency_id` da vitrine com mais de 7 dias.
- **WhatsApp** para avisos de lead ainda não está ligado (campo existe). V2: API oficial da Meta ou Z-API.
- **Atendimento humano por consulta periódica** (o widget pergunta a cada poucos segundos durante o atendimento). Com muito volume, trocar por Supabase Realtime.
- **Portal do cliente sem login**: quem tem o link vê os contatos daquele cliente. Dá para trocar ou desligar o link a qualquer momento no painel.

# atendia
