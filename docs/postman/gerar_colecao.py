"""Gera a coleção e o ambiente do Postman da API do BoaVoz (rode na raiz do repositório: python docs/postman/gerar_colecao.py)."""
import json
import uuid
import io

OUT = "docs/postman"

# ------------------------------------------------------------------ helpers


def script(*lines):
    return {"type": "text/javascript", "exec": list(lines)}


def req(name, method, path, *, body=None, query=None, desc="", tests=(), idem=True, headers=None, token=None, pre=()):
    hdr = []
    if body is not None:
        hdr.append({"key": "Content-Type", "value": "application/json"})
    if method == "POST" and idem:
        hdr.append({"key": "Idempotency-Key", "value": "{{$guid}}", "description": "Uma chave nova a cada envio (o Postman gera). Repetir a mesma chave devolve a mesma resposta."})
    for k, v in (headers or {}).items():
        hdr.append({"key": k, "value": v})
    segs = [s for s in path.strip("/").split("/")]
    url = {"raw": "{{base_url}}/" + path.strip("/"), "host": ["{{base_url}}"], "path": segs}
    if query:
        url["query"] = [{"key": k, "value": v, **({"disabled": True} if off else {})} for k, v, off in query]
        on = [f"{k}={v}" for k, v, off in query if not off]
        if on:
            url["raw"] += "?" + "&".join(on)
    r = {"method": method, "header": hdr, "url": url, "description": desc}
    if token is not None:
        r["auth"] = {"type": "bearer", "bearer": [{"key": "token", "value": token, "type": "string"}]}
    if body is not None:
        r["body"] = {"mode": "raw", "raw": json.dumps(body, ensure_ascii=False, indent=2), "options": {"raw": {"language": "json"}}}
    item = {"name": name, "request": r}
    events = []
    if pre:
        events.append({"listen": "prerequest", "script": script(*pre)})
    if tests:
        events.append({"listen": "test", "script": script(*tests)})
    if events:
        item["event"] = events
    return item


def folder(name, desc, items):
    return {"name": name, "description": desc, "item": items}


def expect_status(*codes):
    if len(codes) == 1:
        return [f'pm.test("status {codes[0]}", () => pm.response.to.have.status({codes[0]}));']
    return [f'pm.test("status {" ou ".join(map(str, codes))}", () => pm.expect([{", ".join(map(str, codes))}]).to.include(pm.response.code));']


def expect_error(status, code):
    return [
        f'pm.test("status {status}", () => pm.response.to.have.status({status}));',
        f'pm.test("erro {code}", () => pm.expect(pm.response.json().error.code).to.eql("{code}"));',
    ]


SAVE_SENT = [
    "if (pm.response.code === 201 || pm.response.code === 202) {",
    "  const r = pm.response.json();",
    "  pm.environment.set(\"message_id\", r.message_id);",
    "  pm.test(\"status da mensagem: \" + r.status, () => pm.expect([\"sent\", \"uncertain\"]).to.include(r.status));",
    "}",
]

BOT = "{{bot_id}}"

# ------------------------------------------------------------------ pastas

conversas = folder(
    "1. Conversas",
    "Leitura das conversas e do histórico (permissão **conversations**). A listagem guarda no ambiente o id da conversa mais recente de cada canal (`whatsapp_conversation_id`, `instagram_conversation_id`, `widget_conversation_id`), o contato delas e o `conversation_id` usado nas pausas (o do WhatsApp, quando há).",
    [
        req(
            "Listar conversas (guarda os ids)",
            "GET",
            "conversations",
            query=[("limit", "20", False), ("channel", "whatsapp", True), ("status", "ai_paused", True), ("since", "2026-10-01T00:00:00Z", True), ("contact", "phone:{{phone}}", True), ("bot_id", BOT, True)],
            desc="Mais recente primeiro. Filtros (ligue na aba Params): `channel` (widget, whatsapp, instagram), `status` (ai, ai_paused, waiting_human, human), `since`, `contact` e `bot_id`. Paginação por `next_cursor`.",
            tests=expect_status(200)
            + [
                "const body = pm.response.json();",
                "const data = body.data || [];",
                "for (const ch of [\"whatsapp\", \"instagram\", \"widget\"]) {",
                "  const c = data.find((x) => x.channel === ch);",
                "  if (!c) continue;",
                "  pm.environment.set(ch + \"_conversation_id\", c.id);",
                "  if (c.contact) pm.environment.set(ch + \"_contact\", c.contact.id);",
                "}",
                "const main = data.find((x) => x.channel === \"whatsapp\") || data[0];",
                "if (main) pm.environment.set(\"conversation_id\", main.id);",
                "pm.environment.set(\"next_cursor\", body.next_cursor || \"\");",
                "console.log(\"conversas:\", data.map((c) => `${c.channel} ${c.status} ${c.id}`).join(\"\\n\"));",
            ],
        ),
        req("Próxima página", "GET", "conversations", query=[("limit", "20", False), ("cursor", "{{next_cursor}}", False)], desc="Usa o `next_cursor` da listagem anterior.", tests=expect_status(200) + ['pm.environment.set("next_cursor", pm.response.json().next_cursor || "");']),
        req("Só as pausadas pela integração", "GET", "conversations", query=[("status", "ai_paused", False)], tests=expect_status(200)),
        req(
            "Histórico da conversa",
            "GET",
            "conversations/{{conversation_id}}/messages",
            query=[("limit", "50", False), ("cursor", "", True)],
            desc="Da mais antiga para a mais nova, com status (received, sent, delivered, read, failed, uncertain) e error. Guarda o id da última mensagem em `message_id`. Mensagem com arquivo traz `media`: no áudio, a transcrição; na foto que a IA leu, o `reading` (tipo, descrição e texto da foto).",
            tests=expect_status(200)
            + [
                "const data = pm.response.json().data || [];",
                "if (data.length) pm.environment.set(\"message_id\", data[data.length - 1].id);",
                "const comArquivo = data.filter((m) => m.media).pop();",
                "if (comArquivo) pm.environment.set(\"media_id\", comArquivo.media.id);",
                "const lida = data.filter((m) => m.media && m.media.reading).pop();",
                "if (lida) console.log(`foto lida pela IA (${lida.media.reading.type}): ${lida.media.reading.description || '-'}`);",
                "console.log(data.map((m) => `${m.direction} ${m.source} ${m.status}: ${(m.text || \"\").slice(0, 60)}`).join(\"\\n\"));",
            ],
        ),
        req("Uma mensagem", "GET", "messages/{{message_id}}", desc="Permissão **messages**. O status também chega por webhook (message.status) e no histórico. Mensagem com arquivo traz `media` (id, tipo, tamanho, nome e um link de 1 hora; no áudio, a transcrição; na foto que a IA leu, o `reading`).", tests=expect_status(200)),
        req(
            "Baixar arquivo",
            "GET",
            "media/{{media_id}}",
            desc="O arquivo da última mensagem com mídia do histórico (`media_id`), decifrado. Clique em **Save Response** para salvar. Depois do prazo de guarda (ou da exclusão), 410.",
            tests=expect_status(200) + ['pm.test("tem o tipo do arquivo", () => pm.expect(pm.response.headers.get("Content-Type")).to.be.a("string"));'],
        ),
    ],
)

pausa = folder(
    "2. Pausa da IA",
    "A integração pausa a IA numa conversa (sem avisar a equipe). Toda pausa tem prazo: sem `minutes`, 24 horas renovadas a cada mensagem enviada pela API; com `minutes`, de 1 a 10.080. Usa `{{conversation_id}}` (rode a listagem antes).",
    [
        req("Pausar por 10 minutos", "POST", "conversations/{{conversation_id}}/pause", body={"minutes": 10}, tests=expect_status(200) + ['pm.test("tem ai_paused_until", () => pm.expect(pm.response.json().ai_paused_until).to.be.a("string"));']),
        req("Pausar 24 h com anúncio (Ana)", "POST", "conversations/{{conversation_id}}/pause", body={"announce": True, "agent_name": "Ana"}, desc="A primeira mensagem enviada pela API sai com o anúncio de entrada com o nome; na volta, a IA usa o \"Voltei!\".", tests=expect_status(200)),
        req("Pausar por 1 minuto (testar o vencimento)", "POST", "conversations/{{conversation_id}}/pause", body={"minutes": 1}, desc="Mande uma mensagem pelo celular durante a pausa e espere uns 2 minutos: a IA responde sozinha (handoff.returned com reason timeout).", tests=expect_status(200)),
        req("Retomar", "POST", "conversations/{{conversation_id}}/resume", body={}, desc="A IA responde a última mensagem do contato se ela ficou sem resposta (handoff.returned com reason api).", tests=expect_status(200)),
        req("Retomar com anúncio", "POST", "conversations/{{conversation_id}}/resume", body={"announce": True}, tests=expect_status(200)),
    ],
)

mensagens = folder(
    "3. Enviar mensagens",
    "POST /v1/messages (permissão **messages**). Cada envio leva uma Idempotency-Key nova; a requisição \"Repetir com a mesma chave\" mostra a idempotência. WhatsApp: mande um \"oi\" do seu celular antes, para abrir a janela de 24 horas.",
    [
        req("Texto no WhatsApp (pelo telefone)", "POST", "messages", body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "Teste da API do BoaVoz"}, tests=expect_status(201, 202) + SAVE_SENT),
        req(
            "Texto assinado (agent_name e sender)",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "Seu pedido saiu para entrega.", "agent_name": "Ana", "sender": "postman"},
            desc="Chega como \"*Ana:* …\". No webhook message.sent: source api, agent.display_name Ana, agent.sender postman e o key_prefix.",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req("Texto no WhatsApp (pelo contato)", "POST", "messages", body={"bot_id": BOT, "to": "{{whatsapp_contact}}", "type": "text", "text": "Teste pelo id do contato"}, tests=expect_status(201, 202) + SAVE_SENT),
        req("Texto no Instagram", "POST", "messages", body={"bot_id": BOT, "to": "{{instagram_contact}}", "type": "text", "text": "Teste da API pelo Instagram"}, desc="Usa o contato da conversa de Instagram mais recente (rode a listagem antes). A pessoa precisa ter escrito nas últimas 24 horas.", tests=expect_status(201, 202) + SAVE_SENT),
        req("Texto no chat do site", "POST", "messages", body={"conversation_id": "{{widget_conversation_id}}", "type": "text", "text": "Oi! Aqui é o sistema integrado.", "agent_name": "Ana"}, desc="O visitante vê em segundos (o widget busca as novidades). Abra o chat do site e mande uma mensagem antes.", tests=expect_status(201) + SAVE_SENT),
        req(
            "Imagem no WhatsApp (com legenda)",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "image", "image": {"url": "{{image_url}}"}, "text": "Foto do seu pedido"},
            desc="JPEG ou PNG até 5 MB. O BoaVoz baixa a URL, confere o tipo e guarda uma cópia; a Meta busca o arquivo na URL. `text` vira a legenda.",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Documento no WhatsApp",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "document", "document": {"url": "{{document_url}}", "filename": "Boleto teste.pdf"}, "text": "Segue o seu boleto"},
            desc="PDF, Word, Excel, PowerPoint, TXT ou CSV, até 16 MB. `filename` é o nome que o contato vê.",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Documento no Instagram (PDF)",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "{{instagram_contact}}", "type": "document", "document": {"url": "{{document_url}}"}, "text": "Segue o PDF"},
            desc="No Instagram, arquivo só em PDF e imagem em PNG ou JPEG (até 8 MB). O Instagram não tem legenda: o texto chega numa DM antes do arquivo.",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Imagem no chat do site",
            "POST",
            "messages",
            body={"conversation_id": "{{widget_conversation_id}}", "type": "image", "image": {"url": "{{image_url}}"}, "text": "Olha a foto", "agent_name": "Ana"},
            desc="O visitante vê a imagem no balão da Ana (clicar abre ampliada). Documento no site: só PDF.",
            tests=expect_status(201) + SAVE_SENT,
        ),
        req(
            "Modelo do WhatsApp",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "template", "template": {"name": "{{template_name}}", "language": "{{template_language}}", "variables": ["{{template_variable_1}}"]}},
            desc="Funciona também fora da janela de 24 horas. Ajuste `variables` ao número de variáveis do modelo (veja em \"Modelos do bot\"); modelo sem variável: `[]`. Chatbot sem tamanho: 422 bot_without_size.",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Repetir com a mesma chave (idempotência)",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "Mensagem idempotente"},
            idem=False,
            headers={"Idempotency-Key": "{{idempotency_key}}"},
            desc="Rode duas vezes: a segunda devolve o mesmo message_id, com o cabeçalho Idempotent-Replayed: true, e só uma mensagem chega. Troque `idempotency_key` no ambiente para testar de novo.",
            tests=expect_status(201, 202)
            + ['pm.test("replay na segunda vez", () => { if (pm.response.headers.get("Idempotent-Replayed")) pm.expect(pm.response.headers.get("Idempotent-Replayed")).to.eql("true"); });'],
        ),
    ],
)

modelos = folder(
    "4. Modelos",
    "Modelos do WhatsApp do bot (permissão **messages**).",
    [
        req(
            "Modelos do bot",
            "GET",
            f"bots/{BOT}/templates",
            desc="Com categoria, status da Meta, número de variáveis e se dá para enviar. Guarda o primeiro modelo enviável em `template_name` e `template_language`.",
            tests=expect_status(200)
            + [
                "const all = pm.response.json().data || [];",
                "const t = all.find((x) => x.sendable);",
                "if (t) { pm.environment.set(\"template_name\", t.name); pm.environment.set(\"template_language\", t.language); }",
                "const mkt = all.find((x) => x.sendable && x.category === \"marketing\");",
                "if (mkt) pm.environment.set(\"marketing_template\", mkt.name);",
                "const utl = all.find((x) => x.sendable && x.category === \"utility\");",
                "if (utl) pm.environment.set(\"reminder_template\", utl.name);",
                "console.log((pm.response.json().data || []).map((x) => `${x.name} (${x.language}) ${x.category} ${x.status} vars=${x.variables}${x.sendable ? \"\" : \" — não enviável\"}`).join(\"\\n\"));",
            ],
        ),
    ],
)

contatos = folder(
    "5. Contatos e pareamento",
    "Contatos, etiquetas, leads e idade (permissão **contacts**), aceite de novidades (permissão **campaigns**) e pareamento com o sistema do cliente (permissão **pairing**).",
    [
        req(
            "Listar contatos",
            "GET",
            "contacts",
            query=[("limit", "20", False), ("channel", "whatsapp", True), ("tag", "vip", True), ("since", "2026-10-01T00:00:00Z", True), ("bot_id", BOT, True)],
            desc="Na ordem da última alteração (para sincronizar: guarde o `updated_at` do último e use em `since`). Cada contato vem com etiquetas, consentimento (`consent.marketing` e `consent.opted_out`) e `age_confirmed`.",
            tests=expect_status(200)
            + [
                "const data = pm.response.json().data || [];",
                "const wa = data.find((c) => c.channel === \"whatsapp\");",
                "if (wa && !pm.variables.get(\"whatsapp_contact\")) pm.environment.set(\"whatsapp_contact\", wa.id);",
                "console.log(data.map((c) => `${c.channel} ${c.id} ${c.name || \"\"} tags=${c.tags.join(\"|\")} promo=${c.consent ? c.consent.marketing : \"-\"}`).join(\"\\n\"));",
            ],
        ),
        req(
            "Etiquetas do contato",
            "PUT",
            "contacts/{{whatsapp_contact}}/tags",
            body={"bot_id": BOT, "tags": ["vip", "postman"]},
            desc="Troca todas as etiquetas (lista vazia apaga). Com `ext:<id>`, vale para todos os contatos do bot com aquele id externo.",
            tests=expect_status(200),
        ),
        req(
            "Aceite de novidades (sim)",
            "POST",
            "contacts/phone:{{phone}}/consent",
            body={"bot_id": BOT, "channel": "whatsapp", "granted": True, "source": "Teste pelo Postman", "text": "Aceito receber novidades e promoções por WhatsApp"},
            desc="Permissão **campaigns**. Grava o aceite com a prova (origem, texto e data). Cria o contato do WhatsApp se ele ainda não existe. Quem pediu para sair continua fora (`opted_out: true`): só um novo sim dele no chat tira do descadastro.",
            tests=expect_status(201) + ['const r = pm.response.json(); console.log("consent:", r.consent_id, "opted_out:", r.opted_out);'],
        ),
        req(
            "Retirar o aceite",
            "POST",
            "contacts/phone:{{phone}}/consent",
            body={"bot_id": BOT, "channel": "whatsapp", "granted": False, "source": "Pedido pelo atendimento", "text": "Não quero mais receber promoções"},
            desc="Revoga o aceite ativo e sai o webhook contact.opted_out (source api).",
            tests=expect_status(201),
        ),
        req(
            "Leads",
            "GET",
            "leads",
            query=[("limit", "20", False), ("channel", "whatsapp", True), ("since", "2026-10-01T00:00:00Z", True), ("updated_since", "2026-10-15T00:00:00Z", True), ("bot_id", BOT, True)],
            desc="Um lead por contato em cada chatbot, do mais antigo para o mais novo: nome, telefone, e-mail, o pedido mais recente (`notes`) e o histórico (`requests`, com data, canal, conversa e o que a pessoa pediu). `updated_since` traz só os que mudaram (pedido novo ou contato) desde a data; o webhook lead.updated avisa na hora. Paginação por `next_cursor`.",
            tests=expect_status(200),
        ),
        req("Idade confirmada pela empresa", "PUT", "contacts/phone:{{phone}}/age", body={"bot_id": BOT, "age_verified": True, "origin": "Teste pelo Postman"}, desc="O contato passa a ter 18+ confirmado (origem company).", tests=expect_status(200)),
        req(
            "Criar código de pareamento",
            "POST",
            "pairings",
            body={"bot_id": BOT, "channel": "whatsapp", "external_id": "{{external_id}}", "display": {"name": "Teste Postman"}},
            desc="Devolve o código de 6 caracteres e o link (vale 10 minutos). O pareamento só termina quando a pessoa abre o link no celular (ele abre o WhatsApp do bot com \"Conectar <código>\" escrito), manda a mensagem e confirma. Guarda o código e o link no ambiente (`pairing_code`, `pairing_link`).",
            tests=expect_status(201)
            + [
                "const r = pm.response.json();",
                "pm.environment.set(\"pairing_code\", r.code);",
                "pm.environment.set(\"pairing_link\", r.link || \"\");",
                "console.log(\"código:\", r.code, \"| abra no celular:\", r.link);",
            ],
        ),
        req(
            "Vínculos do usuário",
            "GET",
            "contacts/ext:{{external_id}}/links",
            desc="Os vínculos ativos do `external_id`. Sem vínculo (pareamento ainda não concluído pelo celular, ou depois de desvincular), a lista vem vazia. Guarda o primeiro em `link_id`.",
            tests=expect_status(200)
            + [
                "const d = pm.response.json().data || [];",
                "if (d[0]) pm.environment.set(\"link_id\", d[0].id);",
                "else console.log(\"Sem vínculo ativo para\", pm.variables.get(\"external_id\"), \"- abra o pairing_link no celular, mande a mensagem e confirme; depois rode de novo.\");",
            ],
        ),
        req("Desvincular", "DELETE", "contacts/ext:{{external_id}}/links/{{link_id}}", tests=expect_status(204)),
    ],
)

FUTURE = ['// daqui a 10 minutos (o lembrete e a campanha agendada precisam de data no futuro)', 'pm.environment.set("send_at_future", new Date(Date.now() + 10 * 60 * 1000).toISOString());']
SAVE_CAMPAIGN = [
    "if (pm.response.code === 201) {",
    "  const r = pm.response.json();",
    "  pm.environment.set(\"campaign_id\", r.campaign_id);",
    "  console.log(\"campanha:\", r.campaign_id, r.status, \"contatos:\", r.estimated_contacts, \"fora:\", JSON.stringify(r.excluded));",
    "}",
]

campanhas = folder(
    "8. Campanhas e lembretes",
    "POST /v1/campaigns (permissão **campaigns**), sempre com Idempotency-Key (a coleção gera uma por envio). Campanha de marketing só vai para quem aceitou novidades; lembrete usa modelo de utilidade. Os envios saem pelo mesmo motor do painel e aparecem na aba Campanhas do cliente.",
    [
        req(
            "Campanha de marketing (por etiqueta)",
            "POST",
            "campaigns",
            body={"bot_id": BOT, "kind": "marketing", "name": "Teste Postman", "template": {"name": "{{marketing_template}}", "language": "pt_BR", "variables": [{"type": "first_name", "fallback": "cliente"}]}, "audience": {"tags": ["vip"]}},
            desc="Público: contatos com a etiqueta \"vip\" (use **5. Etiquetas do contato** antes) que aceitaram novidades. `{\"type\": \"first_name\", \"fallback\": \"cliente\"}` põe o primeiro nome do contato na variável. Ajuste `variables` ao modelo. Público sem ninguém apto: 422 empty_audience, com quem ficou de fora e por quê. Chatbot sem tamanho: 422 bot_without_size.",
            tests=expect_status(201) + SAVE_CAMPAIGN,
        ),
        req(
            "Campanha agendada (pelo telefone)",
            "POST",
            "campaigns",
            body={"bot_id": BOT, "kind": "marketing", "template": {"name": "{{marketing_template}}", "language": "pt_BR", "variables": [{"type": "first_name", "fallback": "cliente"}]}, "audience": {"contacts": ["phone:{{phone}}"]}, "send_at": "{{send_at_future}}"},
            desc="Sai daqui a 10 minutos (status scheduled). `contacts` aceita phone:, ctc_ e ext:.",
            pre=FUTURE,
            tests=expect_status(201) + SAVE_CAMPAIGN,
        ),
        req(
            "Lembretes (uma linha por envio)",
            "POST",
            "campaigns",
            body={"bot_id": BOT, "kind": "utility_reminder", "name": "Lembrete teste", "template": {"name": "{{reminder_template}}", "language": "pt_BR"}, "sends": [{"contact": "phone:{{phone}}", "send_at": "{{send_at_future}}", "variables": ["{{template_variable_1}}"]}]},
            desc="Modelo de utilidade; cada linha sai na hora dela. `variables` precisa ter o número de variáveis do modelo. Contato que nunca conversou com o bot exige a declaração de lembretes do cliente (sem ela: 400 apontando utility_consent).",
            pre=FUTURE,
            tests=expect_status(201) + SAVE_CAMPAIGN,
        ),
        req(
            "Status da campanha",
            "GET",
            "campaigns/{{campaign_id}}",
            desc="Status (scheduled, sending, paused, finished, canceled) e os totais: enviadas, entregues, lidas, respondidas, falhas, puladas por motivo e descadastros.",
            tests=expect_status(200) + ['const t = pm.response.json().totals; console.log(pm.response.json().status, JSON.stringify(t));'],
        ),
    ],
)

BOTOES = [{"title": "Sim, quero", "id": "quero_cardapio"}, {"title": "Agora não", "id": "agora_nao"}]
COM_ACAO = [{"title": "Pedir calabresa", "action": {"name": "adicionar_ao_carrinho", "params": {"item": "101"}}}, {"title": "Ver cardápio", "id": "ver_cardapio"}]
CARDS = [
    {"image": "https://placehold.co/800x600.png?text=Calabresa", "title": "Pizza Calabresa", "text": "R$ 49,90. Calabresa, cebola e azeitona.", "buttons": [{"title": "Pedir este", "action": {"name": "adicionar_ao_carrinho", "params": {"item": "101"}}}]},
    {"image": "https://placehold.co/800x600.png?text=Marguerita", "title": "Pizza Marguerita", "text": "R$ 45,90. Tomate, muçarela e manjericão.", "buttons": [{"title": "Pedir este", "action": {"name": "adicionar_ao_carrinho", "params": {"item": "102"}}}]},
    {"image": "https://placehold.co/800x600.png?text=Coca-Cola", "title": "Coca-Cola 2L", "text": "R$ 12,00.", "buttons": [{"title": "Pedir este", "id": "pedir_coca"}]},
]

componentes = folder(
    "9. Botões, lista, link e carrossel",
    "POST /v1/messages com `components` (um por mensagem, junto de um texto): `buttons` (até 3, título até 20), `list` (até 10 itens, título até 24 e descrição até 72), `link` (título até 20, HTTPS) e `carousel` (1 a 10 cards; cada card com `image` ou `video` HTTPS, `title` até 80 e/ou `text` até 300, e `buttons` com 1 ou 2 de resposta ou um `link`, do mesmo tipo e na mesma quantidade em todos os cards). Sem `action`, o clique volta para a IA como mensagem com o título, e o `id` volta no webhook message.received (`interactive.id`). Com `action`, o clique chama a ação direto, sem a IA, e vale como confirmação; os parâmetros ficam no BoaVoz. Ação que cria pedido só vai em `buttons`. No carrossel do WhatsApp, o texto do card leva o título no começo e é cortado em 160 caracteres; 1 card vira mensagem com imagem. No WhatsApp e no Instagram, a pessoa precisa ter escrito nas últimas 24 horas.",
    [
        req(
            "Botões no WhatsApp",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "Quer receber o cardápio do dia?", "components": {"type": "buttons", "buttons": BOTOES}},
            desc="Toque num botão: a IA responde ao título, e o webhook message.received traz `interactive` com o id (`quero_cardapio`).",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Botão com ação (adicionar ao carrinho)",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "A calabresa saiu do forno agora!", "components": {"type": "buttons", "buttons": COM_ACAO}},
            desc="Precisa da ação `adicionar_ao_carrinho` no chatbot (aba Ações). \"Pedir calabresa\" chama a ação direto, com `{\"item\": \"101\"}`; \"Ver cardápio\" volta para a IA.",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Lista no WhatsApp",
            "POST",
            "messages",
            body={
                "bot_id": BOT,
                "to": "phone:{{phone}}",
                "type": "text",
                "text": "Escolha o sabor:",
                "components": {
                    "type": "list",
                    "button": "Ver sabores",
                    "items": [
                        {"title": "Pizza Calabresa", "description": "R$ 49,90", "action": {"name": "adicionar_ao_carrinho", "params": {"item": "101"}}},
                        {"title": "Pizza Marguerita", "description": "R$ 45,90", "action": {"name": "adicionar_ao_carrinho", "params": {"item": "102"}}},
                        {"title": "Falar com a loja", "id": "falar_loja"},
                    ],
                },
            },
            desc="No WhatsApp, a lista abre pelo botão \"Ver sabores\". No Instagram, vira respostas rápidas com o resumo numerado.",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Link no WhatsApp",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "Acompanhe o seu pedido pelo site.", "components": {"type": "link", "title": "Ver pedido", "url": "https://boavoz.com"}},
            desc="No WhatsApp, botão que abre o link. No Instagram, o link vai no texto.",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Carrossel no WhatsApp",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "Saíram do forno agora:", "components": {"type": "carousel", "cards": CARDS}},
            desc="Cards que rolam para o lado, com foto e o botão \"Pedir este\". Nas pizzas, o botão chama `adicionar_ao_carrinho` direto (precisa da ação no chatbot); na Coca-Cola, o toque volta para a IA como \"Pedir este: Coca-Cola 2L\" e o webhook traz `interactive.id` = `pedir_coca`. Item proibido ou 18+ num card: 422 `prohibited_content` (a API nunca edita).",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Carrossel de links",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "Veja no site:", "components": {"type": "carousel", "cards": [{"image": "https://placehold.co/800x600.png?text=Calabresa", "title": "Pizza Calabresa", "link": {"title": "Ver no site", "url": "https://boavoz.com"}}, {"image": "https://placehold.co/800x600.png?text=Marguerita", "title": "Pizza Marguerita", "link": {"title": "Ver no site", "url": "https://boavoz.com"}}]}},
            desc="Um botão de link por card. No Instagram, os cards com o botão de link e, numa DM própria, os links no texto (para quem está no instagram.com pelo computador).",
            tests=expect_status(201, 202) + SAVE_SENT,
        ),
        req(
            "Erro: carrossel com botões diferentes",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "Teste", "components": {"type": "carousel", "cards": [CARDS[0], {"image": "https://placehold.co/800x600.png", "title": "Outro", "buttons": [{"title": "A", "id": "a"}, {"title": "B", "id": "b"}]}]}},
            desc="400 `invalid_request` com `field` = `components.cards[1].buttons`: todos os cards precisam do mesmo tipo e da mesma quantidade de botões (regra do WhatsApp).",
            tests=expect_status(400),
        ),
        req("Carrossel no Instagram", "POST", "messages", body={"bot_id": BOT, "to": "{{instagram_contact}}", "type": "text", "text": "Saíram do forno agora:", "components": {"type": "carousel", "cards": CARDS}}, desc="No app, os cards com foto e o botão \"Pedir este\" (generic template; o toque volta pelo webhook messaging_postbacks). Numa DM própria, o resumo numerado com as respostas rápidas, que é o que aparece no instagram.com pelo computador.", tests=expect_status(201, 202) + SAVE_SENT),
        req("Botões no Instagram", "POST", "messages", body={"bot_id": BOT, "to": "{{instagram_contact}}", "type": "text", "text": "Quer receber o cardápio do dia?", "components": {"type": "buttons", "buttons": BOTOES}}, desc="O texto e, numa DM própria, o resumo numerado com as respostas rápidas (no instagram.com pelo computador, responda com o número).", tests=expect_status(201, 202) + SAVE_SENT),
        req("Botões no chat do site", "POST", "messages", body={"conversation_id": "{{widget_conversation_id}}", "type": "text", "text": "A calabresa saiu do forno agora!", "agent_name": "Ana", "components": {"type": "buttons", "buttons": COM_ACAO}}, desc="Os botões aparecem embaixo do balão da Ana; só a última mensagem da conversa aceita toque.", tests=expect_status(201) + SAVE_SENT),
        req("Carrossel no chat do site", "POST", "messages", body={"conversation_id": "{{widget_conversation_id}}", "type": "text", "text": "Saíram do forno agora:", "agent_name": "Ana", "components": {"type": "carousel", "cards": CARDS}}, desc="Os cards aparecem embaixo do balão da Ana e rolam para o lado.", tests=expect_status(201) + SAVE_SENT),
    ],
)

exclusao = folder(
    "7. Exclusão (LGPD)",
    "**Cuidado: apaga de verdade.** O pedido do titular pela API apaga as conversas, os arquivos, os leads e a ficha do contato, põe o número na lista de supressão e emite o webhook contact.deleted. Use um número de teste em `phone_para_apagar`.",
    [
        req(
            "Apagar contato (pedido do titular)",
            "DELETE",
            "contacts/phone:{{phone_para_apagar}}",
            query=[("bot_id", BOT, False)],
            desc="Responde 202 com o `request_id` na hora; a exclusão roda logo depois. O pedido aparece em Segurança, no painel, como executado (origem API). Depois disso, mandar modelo para esse número volta 422 contact_suppressed.",
            tests=expect_status(202) + ['console.log("pedido:", pm.response.json().request_id);'],
        ),
    ],
)

erros = folder(
    "6. Erros esperados",
    "Cada requisição confere o código de erro que a API deve devolver.",
    [
        req("Corpo inválido (type)", "POST", "messages", body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "audio"}, tests=expect_error(400, "invalid_request")),
        req("Arquivo com tipo errado (PDF como imagem)", "POST", "messages", body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "image", "image": {"url": "{{document_url}}"}}, tests=expect_error(400, "invalid_request") + ['pm.test("aponta a URL", () => pm.expect(pm.response.json().error.details.field).to.eql("image.url"));']),
        req("Pausa com minutes inválido", "POST", "conversations/{{conversation_id}}/pause", body={"minutes": 0}, tests=expect_error(400, "invalid_request")),
        req("Campanha sem Idempotency-Key", "POST", "campaigns", body={"bot_id": BOT, "kind": "marketing", "template": {"name": "x"}, "audience": {"tags": ["vip"]}}, idem=False, tests=expect_error(400, "invalid_request") + ['pm.test("aponta o cabeçalho", () => pm.expect(pm.response.json().error.details.field).to.eql("Idempotency-Key"));']),
        req("Componente fora do formato (4 botões)", "POST", "messages", body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "x", "components": {"type": "buttons", "buttons": BOTOES + BOTOES}}, tests=expect_error(400, "invalid_request") + ['pm.test("aponta o campo", () => pm.expect(pm.response.json().error.details.field).to.eql("components.buttons"));']),
        req("Botão com ação que não existe", "POST", "messages", body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "x", "components": {"type": "buttons", "buttons": [{"title": "Teste", "action": {"name": "acao_que_nao_existe", "params": {}}}]}}, desc="Precisa da janela de 24 horas aberta (a conferência das ações vem depois da janela).", tests=expect_error(400, "invalid_request")),
        req("Pedido numa lista", "POST", "messages", body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "text", "text": "x", "components": {"type": "list", "items": [{"title": "Pedir", "action": {"name": "criar_pedido", "params": {"itens": ["101"], "endereco": "Rua A, 1"}}}]}}, desc="Ação que cria pedido só vai em buttons (precisa da ação `criar_pedido` no chatbot e da janela aberta).", tests=expect_error(400, "invalid_request")),
        req("Etiquetas em contato que não existe", "PUT", "contacts/ctc_00000000-0000-4000-8000-000000000000/tags", body={"bot_id": BOT, "tags": ["vip"]}, tests=expect_error(404, "not_found")),
        req("Aceite sem a prova", "POST", "contacts/phone:{{phone}}/consent", body={"bot_id": BOT, "granted": True}, tests=expect_error(400, "invalid_request")),
        req("Conversa inexistente", "GET", "conversations/conv_00000000-0000-4000-8000-000000000000/messages", tests=expect_error(404, "not_found")),
        req(
            "Portão: regulamentado sem 18+",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone_sem_idade}}", "type": "text", "text": "Temos cerveja gelada hoje!"},
            desc="Use em `phone_sem_idade` um número que escreveu nas últimas 24 horas e não confirmou 18+. Volta prohibited_content com reason age_not_confirmed e o termo.",
            tests=expect_error(422, "prohibited_content") + ['pm.test("motivo age_not_confirmed", () => pm.expect(pm.response.json().error.details.reason).to.eql("age_not_confirmed"));'],
        ),
        req(
            "Fora da janela de 24 h",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone_fora_da_janela}}", "type": "text", "text": "Oi"},
            desc="Use em `phone_fora_da_janela` um número que não escreveu nas últimas 24 horas.",
            tests=expect_error(422, "outside_messaging_window"),
        ),
        req("Chave inválida", "GET", "conversations", token="bv_live_esta_chave_nao_existe_000000", desc="Sobrescreve a autenticação da coleção com uma chave que não existe.", tests=expect_error(401, "invalid_api_key")),
    ],
)

SAVE_USAGE = [
    "if (pm.response.code === 200) {",
    "  const u = pm.response.json();",
    "  pm.test(\"uso do mês\", () => { pm.expect(u).to.have.property(\"quota\"); pm.expect(u).to.have.property(\"used\"); pm.expect(u.overage).to.have.property(\"enabled\"); });",
    "  pm.environment.set(\"bot_size\", u.size === null ? \"\" : u.size);",
    "}",
]

cobranca = folder(
    "10. Cobrança",
    "Uso, tamanho e excedente do chatbot e o crédito da conta. Precisam de uma chave com a permissão **billing** (só o dono da conta cria); o crédito pede também o escopo da conta inteira. Trocar para um tamanho maior e comprar crédito COBRAM no cartão da assinatura (na dev, o cartão de teste da Stripe).",
    [
        req("Uso do chatbot", "GET", f"bots/{BOT}/usage", desc="Tamanho, cota, uso do mês, projeção, média dos meses anteriores, tamanho sugerido, troca agendada e excedente. Guarda o tamanho em `bot_size`.", tests=expect_status(200) + SAVE_USAGE),
        req(
            "Excedente ligado com teto",
            "PATCH",
            f"bots/{BOT}",
            body={"overage": {"enabled": True, "cap_brl": 50}},
            desc="Liga o excedente com teto de R$ 50 no mês (142 atendimentos a mais, a R$ 0,35). Só chatbot com tamanho de IA; nos outros, 422 overage_not_available. Sai o webhook bot.overage_changed.",
            tests=expect_status(200) + ['pm.test("excedente ligado com teto de 50", () => { const o = pm.response.json().overage; pm.expect(o.enabled).to.eql(true); pm.expect(o.cap_brl).to.eql(50); });'],
        ),
        req(
            "Excedente desligado",
            "PATCH",
            f"bots/{BOT}",
            body={"overage": {"enabled": False}},
            desc="Desliga o excedente (o teto fica guardado: sem cap_brl, ele não muda).",
            tests=expect_status(200) + ['pm.test("excedente desligado", () => pm.expect(pm.response.json().overage.enabled).to.eql(false));'],
        ),
        req(
            "Mesmo tamanho (nada muda)",
            "PATCH",
            f"bots/{BOT}",
            body={"size": "{{bot_size}}"},
            headers={"Idempotency-Key": "{{$guid}}"},
            desc="Manda o tamanho atual (guardado por \"Uso do chatbot\"): `size_change.status` volta `unchanged` e nada é cobrado. Para subir de verdade, troque por um tamanho maior: cobra a diferença proporcional até o dia 1º no cartão da assinatura (402 payment_required com a fatura, se o cartão recusar). Descer fica agendado para o dia 1º (status scheduled); mandar o tamanho atual de novo cancela o agendado.",
            tests=expect_status(200) + ['pm.test("nada mudou", () => pm.expect(pm.response.json().size_change.status).to.eql("unchanged"));'],
        ),
        req(
            "Trocar tamanho sem Idempotency-Key",
            "PATCH",
            f"bots/{BOT}",
            body={"size": "G"},
            desc="Trocar o tamanho pode cobrar: a Idempotency-Key é obrigatória.",
            tests=expect_error(400, "invalid_request") + ['pm.test("aponta o cabeçalho", () => pm.expect(pm.response.json().error.details.field).to.eql("Idempotency-Key"));'],
        ),
        req(
            "Tamanho que não existe",
            "PATCH",
            f"bots/{BOT}",
            body={"size": "XL"},
            headers={"Idempotency-Key": "{{$guid}}"},
            tests=expect_error(400, "invalid_request") + ['pm.test("aponta o size", () => pm.expect(pm.response.json().error.details.field).to.eql("size"));'],
        ),
        req("Crédito da conta", "GET", "credit", desc="Saldo, lotes que ainda valem e a recarga automática. Pede chave com escopo da conta inteira (senão, 403 forbidden_scope).", tests=expect_status(200) + ['pm.test("saldo", () => pm.expect(pm.response.json()).to.have.property("balance_brl"));']),
        req(
            "Comprar R$ 50 de crédito (cobra)",
            "POST",
            "credit/purchases",
            body={"amount_brl": 50},
            desc="COBRA R$ 50 no cartão da assinatura (na dev, o de teste da Stripe). 201 com o saldo novo; 402 payment_required com a fatura, se o cartão recusar. O crédito vale 12 meses e não é reembolsável.",
            tests=expect_status(201, 402) + ['if (pm.response.code === 201) pm.test("comprado", () => pm.expect(pm.response.json().status).to.eql("paid"));'],
        ),
        req("Compra abaixo do mínimo", "POST", "credit/purchases", body={"amount_brl": 10}, tests=expect_error(400, "invalid_request") + ['pm.test("aponta o valor", () => pm.expect(pm.response.json().error.details.field).to.eql("amount_brl"));']),
    ],
)

collection = {
    "info": {
        "_postman_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "boavoz-api-v1")),
        "name": "BoaVoz API v1",
        "description": "\n".join(
            [
                "Requisições da API pública do BoaVoz (C pública), com testes automáticos.",
                "",
                "**Antes de começar:** importe também o ambiente `BoaVoz dev`, selecione-o no canto superior direito e preencha `api_key`, `vercel_bypass`, `bot_id` e `phone`.",
                "",
                "- A autenticação (Bearer) e o cabeçalho da proteção da Vercel saem do ambiente, em todas as requisições.",
                "- As listagens guardam os ids no ambiente: rode \"Listar conversas\" primeiro.",
                "- Erros vêm no formato `{\"error\": {\"code\", \"message\", \"details\"}}` e aparecem no Console do Postman.",
                "- A API faz parte do pacote Integrações da conta: sem ele, toda requisição volta `403 plan_not_allowed` (a chave continua guardada).",
                "- A pasta 10 (Cobrança) pede a permissão `billing` na chave; trocar para um tamanho maior e comprar crédito cobram no cartão da assinatura.",
            ]
        ),
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{api_key}}", "type": "string"}]},
    "event": [
        {
            "listen": "prerequest",
            "script": script(
                "// proteção da Vercel: só o dev.boavoz.com pede (fica vazio em produção)",
                'const bypass = pm.variables.get("vercel_bypass");',
                'if (bypass) pm.request.headers.upsert({ key: "x-vercel-protection-bypass", value: bypass });',
            ),
        },
        {
            "listen": "test",
            "script": script(
                "// erro da API: código, mensagem e detalhes no Console do Postman",
                "if (pm.response.code >= 400) {",
                "  try {",
                "    const e = pm.response.json().error;",
                '    console.log(pm.info.requestName, pm.response.code, e.code, e.message, JSON.stringify(e.details || {}));',
                "  } catch (_) {}",
                "}",
            ),
        },
    ],
    "item": [conversas, pausa, mensagens, modelos, contatos, erros, exclusao, campanhas, componentes, cobranca],
}

# Só o que é de cada pessoa fica no ambiente (importado uma vez e preenchido no Postman, nunca no Git).
# O resto tem o valor-padrão dentro da coleção: reimportar a coleção não mexe no ambiente de ninguém.
PERSONAL = {"base_url", "api_key", "vercel_bypass", "bot_id", "phone", "phone_sem_idade", "phone_fora_da_janela", "phone_para_apagar"}

env = {
    "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "boavoz-env-dev")),
    "name": "BoaVoz dev",
    "values": [
        {"key": "base_url", "value": "https://dev.boavoz.com/api/v1", "type": "default", "enabled": True},
        {"key": "api_key", "value": "", "type": "secret", "enabled": True},
        {"key": "vercel_bypass", "value": "", "type": "secret", "enabled": True},
        {"key": "bot_id", "value": "bot_", "type": "default", "enabled": True},
        {"key": "phone", "value": "55", "type": "default", "enabled": True},
        {"key": "phone_sem_idade", "value": "55", "type": "default", "enabled": True},
        {"key": "phone_fora_da_janela", "value": "55", "type": "default", "enabled": True},
        {"key": "phone_para_apagar", "value": "55", "type": "default", "enabled": True},
        {"key": "template_name", "value": "", "type": "default", "enabled": True},
        {"key": "template_language", "value": "pt_BR", "type": "default", "enabled": True},
        {"key": "template_variable_1", "value": "Ruan", "type": "default", "enabled": True},
        {"key": "marketing_template", "value": "", "type": "default", "enabled": True},
        {"key": "reminder_template", "value": "", "type": "default", "enabled": True},
        {"key": "send_at_future", "value": "", "type": "default", "enabled": True},
        {"key": "campaign_id", "value": "", "type": "default", "enabled": True},
        {"key": "external_id", "value": "user_postman_1", "type": "default", "enabled": True},
        {"key": "idempotency_key", "value": "teste-idempotencia-1", "type": "default", "enabled": True},
        {"key": "conversation_id", "value": "", "type": "default", "enabled": True},
        {"key": "whatsapp_conversation_id", "value": "", "type": "default", "enabled": True},
        {"key": "instagram_conversation_id", "value": "", "type": "default", "enabled": True},
        {"key": "widget_conversation_id", "value": "", "type": "default", "enabled": True},
        {"key": "whatsapp_contact", "value": "", "type": "default", "enabled": True},
        {"key": "instagram_contact", "value": "", "type": "default", "enabled": True},
        {"key": "message_id", "value": "", "type": "default", "enabled": True},
        {"key": "next_cursor", "value": "", "type": "default", "enabled": True},
        {"key": "link_id", "value": "", "type": "default", "enabled": True},
        {"key": "image_url", "value": "https://placehold.co/600x400.png", "type": "default", "enabled": True},
        {"key": "document_url", "value": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", "type": "default", "enabled": True},
        {"key": "media_id", "value": "", "type": "default", "enabled": True},
        {"key": "pairing_code", "value": "", "type": "default", "enabled": True},
        {"key": "pairing_link", "value": "", "type": "default", "enabled": True},
        {"key": "bot_size", "value": "", "type": "default", "enabled": True},
    ],
    "_postman_variable_scope": "environment",
}

collection["variable"] = [{"key": v["key"], "value": v["value"], "type": "string"} for v in env["values"] if v["key"] not in PERSONAL]
env["values"] = [v for v in env["values"] if v["key"] in PERSONAL]

with io.open(f"{OUT}/boavoz-api.postman_collection.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(collection, f, ensure_ascii=False, indent=2)
    f.write("\n")
with io.open(f"{OUT}/boavoz-dev.postman_environment.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(env, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("coleção gerada:", sum(len(fd["item"]) for fd in collection["item"]), "requisições")
