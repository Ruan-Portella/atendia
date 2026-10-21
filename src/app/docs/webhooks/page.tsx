import Link from "next/link";
import { Code, DocPage, H2, H3, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Webhooks" };

const ENVELOPE = `
{
  "id": "evt_k3x2f7…",
  "type": "message.received",
  "created_at": "2026-10-15T19:02:11.482Z",
  "bot": { "id": "bot_8c1e…", "name": "Bar do Zé" },
  "client": { "id": "cli_51a0…", "external_id": null },
  "conversation": { "id": "conv_14a2…", "channel": "whatsapp" },
  "contact": {
    "id": "ctc_77d0…",
    "whatsapp_user_id": null,
    "phone": "5511999990000",
    "instagram_id": null,
    "display": { "name": "Ruan" }
  },
  "data": {
    "message": {
      "id": "msg_48213",
      "text": "Pedir este: Pizza Calabresa",
      "media": null,
      "interactive": { "type": "button_reply", "id": "pedir_101", "title": "Pedir este" }
    }
  }
}
`;

const VERIFY = `
// npm i express standardwebhooks
import express from "express";
import { Webhook } from "standardwebhooks";

const app = express();
const wh = new Webhook(process.env.BOAVOZ_WEBHOOK_SECRET); // whsec_... do webhook

app.post("/boavoz/eventos", express.text({ type: "*/*" }), async (req, res) => {
  let evento;
  try {
    evento = wh.verify(req.body, req.headers); // assinatura e horário (até 5 minutos)
  } catch {
    return res.status(401).end();
  }
  // a nova tentativa traz o mesmo id: processe uma vez só
  if (await jaProcessado(evento.id)) return res.status(200).end();
  await fila.publicar(evento); // responda rápido; o trabalho pesado vai para a sua fila
  res.status(200).end();
});
`;

/** Webhooks (spec "Formatos de payload", seção 3, e Peça 2). */
export default function WebhooksDocs() {
  return (
    <DocPage
      title="Webhooks"
      intro="O BoaVoz avisa o seu sistema do que acontece nas conversas e nos canais: mensagem recebida ou enviada, lead, pedido de atendente, aceite de novidades, canal caiu, modelo aprovado e mais."
    >
      <H2 id="configurar">Configurar</H2>
      <p>
        No painel, menu <strong>Integrações</strong> → <strong>Webhooks</strong> (dono ou administrador da agência, com a verificação em duas etapas). Cada webhook tem:
      </p>
      <ul>
        <li>a URL (HTTPS, num endereço público);</li>
        <li>os eventos que ele quer receber;</li>
        <li>o escopo: todos os chatbots da agência, os de um cliente ou chatbots escolhidos;</li>
        <li>cabeçalhos personalizados (opcional, até 10, guardados cifrados);</li>
        <li>o segredo (<code>whsec_…</code>), mostrado uma vez ao criar.</li>
      </ul>
      <p>
        <strong>Enviar teste</strong> manda um <code>webhook.test</code> assinado. Em <strong>Logs</strong> aparecem as entregas, com o corpo e a sua resposta; <strong>Reenviar falhas desde</strong> põe de volta na fila o que falhou a partir de uma data.
      </p>

      <H2 id="envelope">O envelope</H2>
      <p>Todo evento chega no mesmo formato. O que muda de um evento para outro é o <code>data</code>.</p>
      <Code lang="json" code={ENVELOPE} />
      <Table
        head={["Campo", "O que é"]}
        rows={[
          [<code key="i">id</code>, <>Id do evento (<code>evt_…</code>). Sai do próprio fato: a nova tentativa e o reenvio trazem o mesmo id. Use para não processar duas vezes.</>],
          [<code key="t">type</code>, "O evento (tabela abaixo)."],
          [<code key="c">created_at</code>, "Quando o fato aconteceu. A ordem de chegada não é garantida (novas tentativas chegam depois): use este campo para ordenar."],
          [<code key="b">bot</code>, <>O chatbot, com o nome; null nos eventos da conta (<code>account.*</code>).</>],
          [<code key="cl">client</code>, <>O cliente (o negócio) do chatbot, ou null. O <code>external_id</code> é o id dele no seu sistema, quando ele foi criado pela <Link href="/docs/api/provisionamento">API</Link> (senão, null).</>],
          [<code key="cv">conversation</code>, "A conversa e o canal, ou null nos eventos sem conversa."],
          [<code key="ct">contact</code>, <>Quem é: ids do canal (<code>phone</code>, <code>whatsapp_user_id</code>, <code>instagram_id</code>) e o nome, nunca o conteúdo da conversa. null nos eventos sem contato.</>],
          [<code key="d">data</code>, "O que aconteceu."],
        ]}
      />

      <H2 id="eventos">Eventos</H2>
      <H3 id="mensagens">Mensagens</H3>
      <Table
        head={["Evento", "Quando", "data"]}
        rows={[
          [<code key="1">message.received</code>, "O contato mandou uma mensagem (ou tocou num botão).", <><code>message</code> {`{id, text, media, interactive}`}. <code>interactive</code> traz o <code>id</code> do botão que você definiu e o título.</>],
          [<code key="2">message.sent</code>, "Saiu uma mensagem para o contato: da IA, da equipe, da API, de campanha ou do app do celular.", <><code>message</code>, <code>source</code> (<code>ai</code>, <code>human</code>, <code>api</code>, <code>campaign</code>, <code>phone_app</code>) e <code>agent</code> (quem enviou).</>],
          [<code key="3">message.status</code>, "A Meta confirmou entrega ou leitura.", <><code>message</code> {`{id, status}`}: <code>delivered</code> ou <code>read</code>. Desmarcado por padrão: são até 2 eventos por mensagem enviada.</>],
          [<code key="4">message.failed</code>, "A mensagem não chegou ao contato.", <><code>message</code> e <code>error</code> {`{code}`} (o código da Meta).</>],
          [<code key="5">message.deleted</code>, "Uma mensagem foi desfeita (o contato apagou no Instagram, por exemplo).", <><code>message</code> {`{id}`}. As entregas pendentes dela saem da fila antes.</>],
        ]}
      />
      <p>
        Arquivo na mensagem: <code>media</code> traz <code>{`{id, type, mime, size, filename, transcript, reading, url, url_expires_at}`}</code>. O <code>url</code> vale 1 hora (é gerado de novo a cada tentativa); depois, baixe por <code>GET /v1/media/{"{id}"}</code>. Áudio vem com a transcrição; foto que a IA leu vem com <code>reading</code>, o que ela entendeu da foto (veja em <Link href="/docs/api/conversas#arquivos">Arquivos e fotos</Link>).
      </p>
      <H3 id="atendimento">Atendimento</H3>
      <Table
        head={["Evento", "Quando", "data"]}
        rows={[
          [<code key="1">lead.created</code>, "A IA registrou um contato novo para a equipe.", <><code>lead</code> {`{id, name, phone, email, notes}`}.</>],
          [<code key="2">lead.updated</code>, "O mesmo contato voltou com um pedido novo (ou mudou o contato). Um lead por contato em cada chatbot.", <><code>lead</code> e <code>request</code> {`{created_at, channel, conversation_id, text}`} (null quando só o contato mudou).</>],
          [<code key="3">handoff.requested</code>, "A conversa entrou na fila da equipe.", <><code>reason</code>: <code>requested</code> (pediu atendente), <code>lead</code> (deixou um pedido) ou <code>ai_unavailable</code>; <code>priority</code> (<code>urgent</code> em risco à vida); <code>outside_hours</code>.</>],
          [<code key="4">handoff.returned</code>, "A conversa voltou para a IA.", <><code>reason</code> (<code>agent_resumed</code>, <code>timeout</code>, <code>api</code>) e <code>agent</code>.</>],
          [<code key="5">conversation.assigned</code>, "A conversa chegou a uma pessoa da equipe: ela assumiu, o rodízio do setor entregou ou veio numa transferência.", <><code>agent</code> {`{id, display_name, type}`}, <code>by</code> (<code>agent</code>, <code>rotation</code> ou <code>transfer</code>), <code>previous_agent</code> (quem estava com a conversa, ou null) e <code>sector</code> {`{id, name}`} (ou null).</>],
          [<code key="6">conversation.transferred</code>, "Alguém da equipe transferiu a conversa para outra pessoa ou para um setor. A nota interna não vai no evento.", <><code>from</code> (quem transferiu) e <code>to</code> {`{type, agent, sector}`}: <code>type</code> <code>agent</code> ou <code>sector</code>; no setor com rodízio, <code>agent</code> é quem recebeu.</>],
        ]}
      />
      <H3 id="chamados">Chamados</H3>
      <Table
        head={["Evento", "Quando", "data"]}
        rows={[
          [<code key="1">ticket.created</code>, "Alguém abriu um chamado no chat do site.", <><code>ticket</code> {`{protocol, status, subject}`} e <code>requester</code> {`{name, email, phone}`} (quem abriu).</>],
          [<code key="2">ticket.updated</code>, "O chamado mudou: a equipe trocou o status, respondeu, ou a pessoa escreveu de novo pelo acompanhamento.", <><code>ticket</code>, <code>change</code> (<code>status</code>, <code>resposta_equipe</code> ou <code>mensagem_cliente</code>), <code>previous_status</code> e <code>agent</code> (quem da equipe, quando foi a equipe). Status: <code>aberto</code>, <code>em_andamento</code>, <code>aguardando_cliente</code> e <code>resolvido</code>. A nota interna nunca vai.</>],
        ]}
      />
      <p>
        Para quem já tem um helpdesk (Zendesk, Freshdesk…): o <code>ticket.created</code> leva o necessário para criar o chamado lá, com o protocolo do BoaVoz como referência; o <code>ticket.updated</code> mantém os dois iguais.
      </p>
      <H3 id="roteiros">Roteiros</H3>
      <Table
        head={["Evento", "Quando", "data"]}
        rows={[
          [<code key="1">routine.completed</code>, "O roteiro chegou ao fim.", <><code>routine</code> {`{id, name}`}, <code>run</code> {`{id, started_by, started_at, ended_at, step, steps_total}`} e <code>variables</code> (os dados que o roteiro juntou, <code>{`{type, value}`}</code>, no formato das ações).</>],
          [<code key="2">routine.abandoned</code>, "O roteiro acabou antes do fim.", <>O mesmo (as <code>variables</code> que deu tempo de juntar), mais <code>reason</code>: <code>handoff</code>, <code>cancelled</code>, <code>timeout</code>, <code>idle</code>, <code>replaced</code>, <code>routine_changed</code>, <code>step_unavailable</code> ou <code>context_changed</code> (veja <Link href="/docs/roteiros#fim">Fim do roteiro</Link>).</>],
        ]}
      />
      <H3 id="contato">Contato</H3>
      <Table
        head={["Evento", "Quando", "data"]}
        rows={[
          [<code key="1">contact.opted_in</code>, "Aceitou receber novidades (ou lembretes).", <><code>consent</code> {`{channel, type, source, at}`}; type <code>marketing</code>, <code>utility</code> ou <code>all</code>.</>],
          [<code key="2">contact.opted_out</code>, "Pediu para não receber (SAIR, botão ou o próprio WhatsApp).", <>O mesmo <code>consent</code>.</>],
          [<code key="3">contact.linked</code>, "O contato foi ligado a uma conta do seu sistema (pareamento, ou número lembrado pelo roteiro com a licença da pessoa).", <><code>link</code> {`{id, channel, source, external_id, phone_masked}`}; source <code>pairing</code> ou <code>routine</code>.</>],
          [<code key="4">contact.unlinked</code>, "O vínculo foi desfeito.", <><code>link</code> e <code>reason</code> (<code>api</code>, <code>chat</code>, <code>identity_changed</code>, <code>inactivity</code>, <code>other_person</code>: a pessoa disse que não é quem estava lembrado no número, ou <code>remember_off</code>: a loja desligou o lembrar o número).</>],
          [<code key="5">contact.deleted</code>, "Pedido do titular (LGPD) concluído: os dados do contato foram apagados.", <><code>reason</code> e <code>request_id</code>; o <code>contact</code> traz só id e external_id. Apague do seu lado também.</>],
        ]}
      />
      <H3 id="conta">Campanhas, canais e conformidade</H3>
      <Table
        head={["Evento", "Quando", "data"]}
        rows={[
          [<code key="1">campaign.finished</code>, "Uma campanha ou lote de lembretes terminou.", <><code>campaign</code> com os totais: enviadas, entregues, lidas, falhas, puladas (sem aceite, sem 18+, na supressão) e saídas.</>],
          [<code key="2">channel.connected</code>, "WhatsApp ou Instagram conectado.", <><code>channel</code>.</>],
          [<code key="3">channel.disconnected</code>, "O canal caiu ou foi desconectado.", <><code>channel</code> e <code>reason</code> {`{code, message}`}.</>],
          [<code key="4">channel.issue</code>, "Problema no canal sem desconectar (hoje: a conta do WhatsApp sem forma de pagamento).", <><code>channel</code> e <code>issue</code> {`{code, message}`}.</>],
          [<code key="5">template.status_changed</code>, "A Meta aprovou, recusou ou pausou um modelo do número.", <><code>template</code> {`{name, language, category, status, reason}`}.</>],
          [<code key="6">bot.paused</code>, "O chatbot foi pausado.", <><code>bot</code>, <code>paused_by</code> e <code>reason</code>.</>],
          [<code key="7">bot.resumed</code>, "O chatbot voltou.", <><code>bot</code> e <code>resumed_by</code>.</>],
          [<code key="8">compliance.changed</code>, "Mudou a situação do cliente nas regras de uso.", <><code>compliance</code> {`{status, previous_status, restrictions, …}`}.</>],
        ]}
      />
      <H3 id="cobranca">Cota, excedente e crédito</H3>
      <p>
        Todos trazem o uso do mês no <code>data</code>: <code>month</code>, <code>used</code> (dentro da cota), <code>quota</code> e <code>overage</code> {`{enabled, used, cap_brl, max, value_brl}`}. Cada aviso sai uma vez por mês e chatbot.
      </p>
      <Table
        head={["Evento", "Quando", "data"]}
        rows={[
          [<code key="1">bot.quota_warning</code>, "O chatbot chegou a 80% ou 95% da cota do mês.", <><code>level</code> (80 ou 95) e o uso.</>],
          [<code key="2">bot.overage_started</code>, "O primeiro atendimento a mais do mês: a cota acabou com o excedente ligado.", "O uso."],
          [<code key="3">bot.overage_cap_warning</code>, "O excedente chegou a 80% ou 95% do teto (só quando há teto).", <><code>level</code> e o uso.</>],
          [<code key="4">bot.quota_reached</code>, "O chatbot parou de abrir atendimentos com a IA (modo só humano) até o mês virar ou alguém agir.", <><code>reason</code>: <code>cota</code> (cheia, sem excedente), <code>teto</code>, <code>sem_credito</code> ou <code>excedente_suspenso</code> (pico no chat do site); e o uso.</>],
          [<code key="5">bot.size_changed</code>, "O tamanho mudou, foi agendado para o dia 1º ou o agendado saiu.", <><code>status</code> (<code>applied</code>, <code>scheduled</code>, <code>cancelled</code>), <code>size</code>, <code>volume_packs</code>, <code>previous</code> e <code>effective_at</code>.</>],
          [<code key="6">bot.overage_changed</code>, "O excedente foi ligado, desligado, mudou de teto, ficou suspenso (pico ou ataque) ou voltou.", <><code>enabled</code>, <code>cap_brl</code> e <code>suspended</code> (<code>pico</code>, <code>ataque</code> ou null).</>],
          [<code key="7">bot.month_closed</code>, "Nos primeiros dias do mês, o fechamento do mês anterior de cada chatbot com tamanho ou atendimento.", <><code>month</code>, <code>size</code> e <code>quota</code> que valeram, <code>atendimentos</code>, <code>overage_atendimentos</code>, <code>overage_value_brl</code> e <code>next</code> (o tamanho de agora).</>],
          [<code key="8">account.credit_low</code>, "O crédito da conta ficou abaixo de 20% da última compra.", <><code>balance_brl</code>, <code>last_purchase_brl</code>, <code>low_threshold_brl</code> e <code>auto_recharge</code>.</>],
          [<code key="9">account.credit_depleted</code>, "O crédito não paga o próximo atendimento a mais.", "Os mesmos campos."],
        ]}
      />
      <Note title="Eventos da conta">
        <code>account.credit_low</code> e <code>account.credit_depleted</code> são da conta, não de um chatbot: vêm com <code>bot</code> null e só para os webhooks com escopo de toda a conta.
      </Note>

      <Note title="Aceite do negócio">
        No WhatsApp e no Instagram, os eventos com conteúdo de conversa ou de contato (mensagens, lead, atendimento e consentimento) só saem depois que o negócio aceita os termos de uso daquele canal, na conexão. Os de campanha, canal, modelo, pausa e conformidade saem sempre.
      </Note>

      <H2 id="receber">Receber e conferir</H2>
      <p>
        O BoaVoz faz um <code>POST</code> com o envelope, assinado no padrão{" "}
        <a href="https://www.standardwebhooks.com/" target="_blank" rel="noopener noreferrer">
          Standard Webhooks
        </a>{" "}
        com o segredo do webhook: cabeçalhos <code>webhook-id</code> (o id do evento), <code>webhook-timestamp</code> e <code>webhook-signature</code>. Confira com a biblioteca oficial e responda 2xx rápido.
      </p>
      <Code lang="javascript · node" code={VERIFY} />

      <H2 id="tentativas">Entrega e novas tentativas</H2>
      <ul>
        <li>Entregue = 2xx em até 10 segundos. Qualquer outra coisa conta como falha.</li>
        <li>Novas tentativas, com o mesmo id: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h e 24 h depois (9 tentativas no total). Cada tentativa vai com horário e assinatura novos.</li>
        <li>
          <strong>410 Gone</strong> desativa o webhook na hora. <strong>3 dias seguidos só de falhas</strong> também desativam. O dono da conta recebe um e-mail com 1 hora de falhas, outro no segundo dia e outro quando o webhook é desativado, com o link para reativar. O painel mostra o motivo; reative e use “Reenviar falhas desde” para recuperar o que ficou para trás.
        </li>
        <li>Até 10 entregas ao mesmo tempo por webhook.</li>
        <li>Um pedido do titular (LGPD) apaga as entregas do contato, inclusive as pendentes, antes do <code>contact.deleted</code>.</li>
      </ul>

      <NextSteps
        items={[
          { href: "/docs/api", title: "API", text: "Chave, convenções, erros e uma página por assunto, com exemplos." },
          { href: "/docs/seguranca", title: "Segurança", text: "Conferir assinaturas e autorizar pelo contato verificado." },
        ]}
      />
      <p className="text-sm text-muted">
        Para testar sem servidor, use o <a href="https://www.svix.com/play/" target="_blank" rel="noopener noreferrer">Svix Play</a>: ele mostra os eventos com os cabeçalhos e o corpo. Veja também <Link href="/docs/acoes">Ações</Link>, que usam a mesma assinatura.
      </p>
    </DocPage>
  );
}
