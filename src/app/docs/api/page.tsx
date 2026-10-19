import Link from "next/link";
import { Code, DocPage, H2, H3, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Referência da API" };

const AUTH = `
curl https://boavoz.com/api/v1/conversations?limit=20 \\
  -H "Authorization: Bearer bv_live_…"
`;

const ERROR = `
{
  "error": {
    "code": "invalid_request",
    "message": "to inválido: use ctc_…, phone:5511999999999, wa:<BSUID>, ig:<id> ou ext:<id externo>.",
    "details": { "field": "to" }
  }
}
`;

const SEND_TEXT = `
POST /v1/messages
{
  "bot_id": "bot_…",
  "to": "phone:5511999990000",
  "type": "text",
  "text": "Seu pedido saiu para entrega!",
  "agent_name": "Ana"
}

→ 201 { "message_id": "msg_…", "conversation_id": "conv_…", "status": "sent" }
`;

const SEND_TEMPLATE = `
POST /v1/messages
{
  "bot_id": "bot_…",
  "to": "phone:5511999990000",
  "type": "template",
  "template": { "name": "pedido_saiu", "language": "pt_BR", "variables": ["Ruan", "1234"] }
}
`;

const SEND_WIDGET = `
POST /v1/messages
{ "conversation_id": "conv_…", "type": "text", "text": "Oi! Aqui é a Ana, da loja.", "agent_name": "Ana" }
`;

const PAUSE = `
POST /v1/conversations/conv_…/pause
{ "minutes": 60, "announce": true, "agent_name": "Ana" }

→ 200 { "ai_paused_until": "2026-10-15T20:02:11Z" }
`;

const CAMPAIGN = `
POST /v1/campaigns
Idempotency-Key: 2f6c…
{
  "bot_id": "bot_…",
  "channel": "whatsapp",
  "kind": "marketing",
  "template": { "name": "promo_sexta", "language": "pt_BR", "variables": [{ "type": "first_name", "fallback": "cliente" }] },
  "audience": { "tags": ["vip"] },
  "send_at": "2026-10-17T18:00:00-03:00"
}

→ 201 { "campaign_id": "cmp_…", "estimated_contacts": 312, "estimated_cost_cents": 1934 }
`;

const PAIRING = `
POST /v1/pairings
{
  "bot_id": "bot_…",
  "channel": "whatsapp",
  "external_id": "usuario_8812",
  "context": { "workspace_id": "ws_44" },
  "display": { "name": "Ruan", "workspace_name": "Família Portella" }
}

→ 201 { "code": "K7Q2M9", "link": "https://wa.me/…?text=Conectar%20K7Q2M9", "expires_at": "…" }
`;

/** Referência da API pública /api/v1 (spec Peças 3, 4, 7 e "Formatos de payload"). */
export default function ApiDocs() {
  return (
    <DocPage
      title="Referência da API"
      intro="Enviar mensagens e campanhas, ler conversas, contatos e leads, pausar a IA numa conversa e ligar contatos às contas do seu sistema."
    >
      <H2 id="autenticacao">Endereço e chave</H2>
      <p>
        Base: <code>https://boavoz.com/api/v1</code> (a API não responde no domínio próprio das agências). Toda requisição leva a chave no cabeçalho <code>Authorization: Bearer</code>.
      </p>
      <Code lang="bash" code={AUTH} />
      <p>
        As chaves ficam em <strong>Integrações</strong> → <strong>Chaves de API</strong> (dono ou administrador). A chave começa com <code>bv_live_</code> e aparece uma vez só; o painel mostra só o começo dela. Cada chave tem:
      </p>
      <ul>
        <li>
          <strong>Escopo:</strong> todos os chatbots da agência, os de um cliente ou chatbots escolhidos. Fora do escopo, a API responde 404, como se não existisse.
        </li>
        <li>
          <strong>Permissões:</strong>
        </li>
      </ul>
      <Table
        head={["Permissão", "Abre"]}
        rows={[
          [<code key="m">messages</code>, "Enviar mensagens, ler uma mensagem e listar os modelos do número."],
          [<code key="c">conversations</code>, "Listar conversas e mensagens, baixar arquivos, pausar e devolver a IA."],
          [<code key="ct">contacts</code>, "Contatos, leads, etiquetas, idade e o pedido de exclusão do titular."],
          [<code key="cp">campaigns</code>, "Campanhas e lembretes, e registrar o aceite de novidades."],
          [<code key="p">pairing</code>, "Pareamento: ligar o contato à conta dele no seu sistema."],
        ]}
      />
      <Note>Dê a cada integração só as permissões e o escopo de que ela precisa, e nunca use a chave no navegador ou num app: ela vale para tudo o que o escopo alcança.</Note>

      <H2 id="convencoes">Convenções</H2>
      <ul>
        <li>JSON nos dois sentidos; corpo de até 32 KB.</li>
        <li>
          Ids com prefixo: <code>bot_</code>, <code>cli_</code>, <code>conv_</code>, <code>ctc_</code> (contato), <code>msg_</code>, <code>med_</code> (arquivo), <code>lead_</code>, <code>cmp_</code> (campanha), <code>mbr_</code> (pessoa da equipe).
        </li>
        <li>
          <strong>Limite:</strong> 50 requisições a cada 5 segundos por chave. Passou disso: 429 <code>rate_limited</code> com <code>Retry-After</code>.
        </li>
        <li>
          <strong>Paginação:</strong> <code>limit</code> de 1 a 100 (padrão 50) e <code>cursor</code> = o <code>next_cursor</code> da resposta anterior (null na última página).
        </li>
        <li>
          <strong>Idempotency-Key</strong> (opcional nos envios, obrigatória em campanhas): vale 24 horas por chave de API. A mesma chave com o mesmo corpo devolve a resposta guardada, sem fazer de novo; com outro corpo, 409 <code>idempotency_conflict</code>. Erro de validação, 429 e 5xx não ficam guardados: dá para repetir com a mesma chave.
        </li>
      </ul>
      <H3 id="contato">Endereço do contato</H3>
      <Table
        head={["Formato", "Quem"]}
        rows={[
          [<code key="1">ctc_…</code>, "O id do contato no BoaVoz."],
          [<code key="2">phone:5511999990000</code>, "O número no WhatsApp (com o 55)."],
          [<code key="3">wa:&lt;BSUID&gt;</code>, "O id de usuário do WhatsApp, quando a Meta não manda o telefone."],
          [<code key="4">ig:&lt;id&gt;</code>, "O id da pessoa no Instagram (IGSID)."],
          [<code key="5">ext:&lt;id&gt;</code>, <>O id da pessoa no seu sistema (depois do pareamento). No envio, pede <code>channel</code>.</>],
        ]}
      />

      <H2 id="erros">Erros</H2>
      <Code lang="json" code={ERROR} />
      <Table
        head={["HTTP", "code", "Quando"]}
        rows={[
          ["400", <code key="1">invalid_request</code>, <>Campo com problema; <code>details.field</code> aponta qual.</>],
          ["401", <code key="2">invalid_api_key</code>, "Chave ausente, inválida ou revogada."],
          ["403", <code key="3">forbidden_scope</code>, "A chave não tem a permissão da rota."],
          ["403", <><code>plan_not_allowed</code>, <code>feature_suspended</code></>, "A conta não tem o pacote do recurso (a API e a identificação são do pacote Integrações), ou ele está suspenso na conta."],
          ["404", <code key="5">not_found</code>, "Não existe ou está fora do escopo da chave."],
          ["409", <code key="6">idempotency_conflict</code>, "Idempotency-Key repetida com outro corpo (ou a primeira ainda está em andamento)."],
          ["410", <code key="7">media_gone</code>, "O arquivo passou do prazo de guarda ou foi apagado."],
          ["422", <><code>outside_messaging_window</code>, <code>channel_not_connected</code>, <code>bot_paused</code>, <code>bot_without_size</code>, <code>contact_suppressed</code>, <code>contact_opted_out</code>, <code>no_marketing_consent</code>, <code>template_category_mismatch</code>, <code>empty_audience</code>, <code>channel_rejected</code></>, "Regra do canal ou do contato: o BoaVoz confere antes de chamar a Meta e diz o motivo."],
          ["422", <code key="9">prohibited_content</code>, <>O portão barrou o texto ou um título (a API nunca edita). <code>details</code> traz o motivo, os trechos e o canal.</>],
          ["429", <code key="10">rate_limited</code>, <>Limite da chave ou do número; espere o <code>Retry-After</code>.</>],
        ]}
      />

      <H2 id="mensagens">Mensagens</H2>
      <Table
        head={["Rota", "Permissão", "O que faz"]}
        rows={[
          [<code key="1">POST /v1/messages</code>, "messages", "Envia texto, modelo, imagem ou documento."],
          [<code key="2">GET /v1/messages/{"{id}"}</code>, "messages", "A mensagem, com o status (sent, delivered, read, failed, uncertain)."],
          [<code key="3">GET /v1/bots/{"{id}"}/templates</code>, "messages", "Os modelos do número do WhatsApp do chatbot: nome, idioma, categoria, status e se dá para enviar pela API (sendable)."],
        ]}
      />
      <p>
        <strong>Para o WhatsApp e o Instagram</strong>: <code>bot_id</code>, <code>to</code> (endereço do contato) e <code>channel</code> (só com <code>ext:</code>). <strong>Para o chat do site</strong>: <code>conversation_id</code>. <code>type</code>: <code>text</code> (até 4.096 caracteres, com <Link href="/docs/mensagens-ricas">components</Link> opcional), <code>template</code> (só WhatsApp), <code>image</code> ou <code>document</code> (<code>{`{url, filename?}`}</code> em HTTPS; <code>text</code> vira a legenda). <code>agent_name</code> (opcional) assina a mensagem como alguém da equipe.
      </p>
      <Code lang="http · texto" code={SEND_TEXT} />
      <Code lang="http · modelo" code={SEND_TEMPLATE} />
      <Code lang="http · chat do site" code={SEND_WIDGET} />
      <ul>
        <li>
          Sem resposta da Meta no prazo: 202 com <code>{`"status": "uncertain"`}</code>. O status da Meta concilia depois (webhook <code>message.status</code> ou <code>message.failed</code>); o BoaVoz nunca reenvia sozinho, então não repita sem a mesma Idempotency-Key.
        </li>
        <li>Erro temporário da Meta: 503 ou 429 com <code>Retry-After</code>.</li>
        <li>Fora da janela de 24 horas, só modelo (422 <code>outside_messaging_window</code> no resto).</li>
      </ul>

      <H2 id="conversas">Conversas</H2>
      <Table
        head={["Rota", "Permissão", "O que faz"]}
        rows={[
          [<code key="1">GET /v1/conversations</code>, "conversations", <>Mais recente primeiro. Filtros: <code>bot_id</code>, <code>channel</code>, <code>contact</code>, <code>since</code> e <code>status</code> (<code>ai</code>, <code>ai_paused</code>, <code>waiting_human</code>, <code>human</code>).</>],
          [<code key="2">GET /v1/conversations/{"{id}"}/messages</code>, "conversations", "O histórico, com direção, origem (contato, IA, equipe, API, campanha, celular), status e arquivos."],
          [<code key="3">POST /v1/conversations/{"{id}"}/pause</code>, "conversations", "Pausa a IA nesta conversa para o seu sistema responder."],
          [<code key="4">POST /v1/conversations/{"{id}"}/resume</code>, "conversations", "Devolve a conversa para a IA."],
          [<code key="5">GET /v1/media/{"{id}"}</code>, "conversations", "Baixa o arquivo de uma mensagem."],
        ]}
      />
      <p>
        <strong>Pausar a IA:</strong> sem <code>minutes</code>, a pausa dura 24 horas e se renova a cada mensagem que você manda pela API nessa conversa; com <code>minutes</code>, de 1 a 10.080 (7 dias). A equipe não é avisada. A IA volta pelo <code>resume</code>, pelo painel, quando alguém da equipe assume ou quando a pausa vence, e responde a última mensagem do contato se ela ficou sem resposta. <code>announce</code> faz a primeira mensagem da API levar a apresentação de quem assumiu, e a volta da IA levar o “Voltei!”.
      </p>
      <Code lang="http" code={PAUSE} />

      <H2 id="contatos">Contatos e leads</H2>
      <Table
        head={["Rota", "Permissão", "O que faz"]}
        rows={[
          [<code key="1">GET /v1/contacts</code>, "contacts", <>Na ordem da última alteração, para sincronizar: etiquetas, aceite de novidades e 18+. Filtros: <code>bot_id</code>, <code>channel</code>, <code>tag</code>, <code>since</code>.</>],
          [<code key="2">PUT /v1/contacts/{"{contact}"}/tags</code>, "contacts", <>Troca as etiquetas (<code>{`{bot_id, tags}`}</code>, até 20).</>],
          [<code key="3">PUT /v1/contacts/{"{contact}"}/age</code>, "contacts", <>A empresa informa a idade: <code>age_verified</code> ou <code>birth_date</code> (nunca guardada) e <code>origin</code> (como conferiu). Um “Não” dado no chat sempre vence.</>],
          [<code key="4">GET /v1/leads</code>, "contacts", <>Um lead por contato, com o histórico de pedidos. Filtros: <code>bot_id</code>, <code>channel</code>, <code>since</code>, <code>updated_since</code>.</>],
          [<code key="5">DELETE /v1/contacts/{"{contact}"}?bot_id=</code>, "contacts", <>Pedido do titular (LGPD) já confirmado por você: apaga conversas, arquivos, leads e a ficha, põe o número na lista de supressão e emite <code>contact.deleted</code>. 202 com <code>request_id</code>.</>],
        ]}
      />

      <H2 id="campanhas">Campanhas e aceite</H2>
      <Table
        head={["Rota", "Permissão", "O que faz"]}
        rows={[
          [<code key="1">POST /v1/campaigns</code>, "campaigns", "Campanha de novidades ou lote de lembretes, com modelo aprovado. Idempotency-Key obrigatória."],
          [<code key="2">GET /v1/campaigns/{"{id}"}</code>, "campaigns", "Status e totais."],
          [<code key="3">POST /v1/contacts/{"{contact}"}/consent</code>, "campaigns", <>Registra que a pessoa aceitou (ou retirou o aceite de) novidades no WhatsApp: <code>granted</code>, <code>source</code> (onde) e <code>text</code> (o que ela aceitou).</>],
        ]}
      />
      <p>
        <code>kind</code> <code>marketing</code>: <code>audience</code> por etiquetas, contatos ou ids externos; só recebe quem aceitou novidades (e, com bebida ou remédio, quem confirmou 18 anos). <code>kind</code> <code>utility_reminder</code>: <code>sends</code> com contato, horário e variáveis de cada um. Quem pediu para sair é pulado; o envio confere tudo de novo, como no painel.
      </p>
      <Code lang="http" code={CAMPAIGN} />

      <H2 id="pareamento">Pareamento</H2>
      <Table
        head={["Rota", "Permissão", "O que faz"]}
        rows={[
          [<code key="1">POST /v1/pairings</code>, "pairing", "Gera o código (6 caracteres, uso único, 10 minutos) e o link que a pessoa abre no WhatsApp ou no Instagram."],
          [<code key="2">GET /v1/contacts/{"{contact}"}/links</code>, "pairing", <>Os vínculos ativos do contato (com <code>ext:</code> sem vínculo, a lista vem vazia).</>],
          [<code key="3">DELETE /v1/contacts/{"{contact}"}/links/{"{id}"}</code>, "pairing", "Desfaz o vínculo (204)."],
        ]}
      />
      <Code lang="http" code={PAIRING} />
      <p>
        Depois do pareamento, as ações recebem o contato no nível usuário, com o <code>external_id</code> e o <code>context</code>; a IA vê só o <code>display</code>.
      </p>

      <NextSteps
        items={[
          { href: "/docs/webhooks", title: "Webhooks", text: "Os eventos que o BoaVoz manda para o seu sistema." },
          { href: "/docs/seguranca", title: "Segurança", text: "Chaves, assinaturas e autorização pelo contato." },
        ]}
      />
    </DocPage>
  );
}
