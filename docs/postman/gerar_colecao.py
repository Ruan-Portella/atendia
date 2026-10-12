"""Gera a coleção e o ambiente do Postman da API do BoaVoz (rode na raiz do repositório: python docs/postman/gerar_colecao.py)."""
import json
import uuid
import io

OUT = "docs/postman"

# ------------------------------------------------------------------ helpers


def script(*lines):
    return {"type": "text/javascript", "exec": list(lines)}


def req(name, method, path, *, body=None, query=None, desc="", tests=(), idem=True, headers=None, token=None):
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
    if tests:
        item["event"] = [{"listen": "test", "script": script(*tests)}]
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
            desc="Da mais antiga para a mais nova, com status (received, sent, delivered, read, failed, uncertain) e error. Guarda o id da última mensagem em `message_id`.",
            tests=expect_status(200)
            + [
                "const data = pm.response.json().data || [];",
                "if (data.length) pm.environment.set(\"message_id\", data[data.length - 1].id);",
                "console.log(data.map((m) => `${m.direction} ${m.source} ${m.status}: ${(m.text || \"\").slice(0, 60)}`).join(\"\\n\"));",
            ],
        ),
        req("Uma mensagem", "GET", "messages/{{message_id}}", desc="Permissão **messages**. O status também chega por webhook (message.status) e no histórico.", tests=expect_status(200)),
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
            "Modelo do WhatsApp",
            "POST",
            "messages",
            body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "template", "template": {"name": "{{template_name}}", "language": "{{template_language}}", "variables": ["{{template_variable_1}}"]}},
            desc="Funciona também fora da janela de 24 horas. Ajuste `variables` ao número de variáveis do modelo (veja em \"Modelos do bot\"); modelo sem variável: `[]`.",
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
                "const t = (pm.response.json().data || []).find((x) => x.sendable);",
                "if (t) { pm.environment.set(\"template_name\", t.name); pm.environment.set(\"template_language\", t.language); }",
                "console.log((pm.response.json().data || []).map((x) => `${x.name} (${x.language}) ${x.category} ${x.status} vars=${x.variables}${x.sendable ? \"\" : \" — não enviável\"}`).join(\"\\n\"));",
            ],
        ),
    ],
)

contatos = folder(
    "5. Contatos e pareamento",
    "Idade informada pela empresa (permissão **contacts**) e pareamento com o sistema do cliente (permissão **pairing**).",
    [
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
                "else console.log(\"Sem vínculo ativo para\", pm.environment.get(\"external_id\"), \"- abra o pairing_link no celular, mande a mensagem e confirme; depois rode de novo.\");",
            ],
        ),
        req("Desvincular", "DELETE", "contacts/ext:{{external_id}}/links/{{link_id}}", tests=expect_status(204)),
    ],
)

erros = folder(
    "6. Erros esperados",
    "Cada requisição confere o código de erro que a API deve devolver.",
    [
        req("Corpo inválido (type)", "POST", "messages", body={"bot_id": BOT, "to": "phone:{{phone}}", "type": "audio"}, tests=expect_error(400, "invalid_request")),
        req("Pausa com minutes inválido", "POST", "conversations/{{conversation_id}}/pause", body={"minutes": 0}, tests=expect_error(400, "invalid_request")),
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
                'const bypass = pm.environment.get("vercel_bypass");',
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
    "item": [conversas, pausa, mensagens, modelos, contatos, erros],
}

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
        {"key": "template_name", "value": "", "type": "default", "enabled": True},
        {"key": "template_language", "value": "pt_BR", "type": "default", "enabled": True},
        {"key": "template_variable_1", "value": "Ruan", "type": "default", "enabled": True},
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
        {"key": "pairing_code", "value": "", "type": "default", "enabled": True},
        {"key": "pairing_link", "value": "", "type": "default", "enabled": True},
    ],
    "_postman_variable_scope": "environment",
}

with io.open(f"{OUT}/boavoz-api.postman_collection.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(collection, f, ensure_ascii=False, indent=2)
    f.write("\n")
with io.open(f"{OUT}/boavoz-dev.postman_environment.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(env, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("coleção gerada:", sum(len(fd["item"]) for fd in collection["item"]), "requisições")
