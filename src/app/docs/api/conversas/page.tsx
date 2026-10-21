import Link from "next/link";
import { Access, DocPage, Example, H2, H3, NextSteps, Route, Table } from "@/components/docs/doc";

export const metadata = { title: "Conversas e pausa · API" };

const E = "conversas";

/** /docs/api/conversas: conversas, histórico, arquivos e a pausa da IA (código em src/lib/api-conversations.ts e api-pause.ts). */
export default function ConversationsApiDocs() {
  return (
    <DocPage eyebrow="Documentação · API" title="Conversas e pausa" intro="Leia as conversas e o histórico de cada uma, baixe os arquivos e pause a IA numa conversa para o seu sistema responder.">
      <Access permission="conversations" />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#listar"><code>GET /v1/conversations</code></Link>, "As conversas, a mais recente primeiro, com filtros."],
          [<Link key="2" href="#historico"><code>GET /v1/conversations/{"{id}"}/messages</code></Link>, "O histórico, com direção, origem, status e arquivos."],
          [<Link key="3" href="#pausar"><code>POST /v1/conversations/{"{id}"}/pause</code></Link>, "Pausa a IA nesta conversa para o seu sistema responder."],
          [<Link key="4" href="#retomar"><code>POST /v1/conversations/{"{id}"}/resume</code></Link>, "Devolve a conversa para a IA."],
          [<Link key="5" href="#arquivo"><code>GET /v1/media/{"{id}"}</code></Link>, "Baixa o arquivo de uma mensagem."],
        ]}
      />

      <Route id="listar" method="GET" path="/v1/conversations" />
      <Example page={E} id="listar" />
      <Table
        head={["Parâmetro", "Regra", "Erro"]}
        rows={[
          [<code key="1">limit</code>, "De 1 a 100 (padrão 50).", <>400 <code>limit</code></>],
          [<code key="2">cursor</code>, <>O <code>next_cursor</code> da resposta anterior (null na última página).</>, <>400 <code>cursor</code></>],
          [<code key="3">bot_id</code>, "Só as conversas deste chatbot (do escopo da chave).", <code key="e">403 forbidden_scope</code>],
          [<code key="4">channel</code>, <><code>widget</code>, <code>whatsapp</code> ou <code>instagram</code>.</>, <>400 <code>channel</code></>],
          [<code key="5">status</code>, <><code>ai</code> (a IA responde), <code>ai_paused</code> (pausada pela integração, até <code>ai_paused_until</code>), <code>waiting_human</code> (pediu atendente e ninguém assumiu) ou <code>human</code> (alguém da equipe assumiu: vem em <code>agent</code>). Cada conversa traz também o <code>sector</code> {`{id, name}`} (ou null) e o <code>snoozed_until</code> (adiada pela equipe na Caixa de entrada até essa data, ou null).</>, <>400 <code>status</code></>],
          [<code key="6">since</code>, <>Só as que tiveram mensagem desde a data (ISO 8601, ex.: <code>2026-10-01T00:00:00Z</code>).</>, <>400 <code>since</code></>],
          [<code key="7">contact</code>, <>Só as de um contato (<Link href="/docs/api#contato">endereço</Link>).</>, <>400 <code>contact</code></>],
        ]}
      />

      <Route id="historico" method="GET" path="/v1/conversations/{id}/messages" />
      <p>
        Da mais antiga para a mais nova, com <code>limit</code> e <code>cursor</code>. Cada mensagem traz a direção (<code>inbound</code> do contato, <code>outbound</code> para ele), a origem (<code>source</code>: <code>contact</code>, <code>ai</code>, <code>human</code>, <code>api</code>, <code>campaign</code> ou <code>phone_app</code>), quem mandou (<code>agent</code>), o status e o arquivo, se houver.
      </p>
      <Example page={E} id="historico" />
      <H3 id="arquivos">Arquivos e fotos</H3>
      <p>
        Mensagem com arquivo traz <code>media</code> {`{id, type, mime, size, filename, transcript, reading, url, url_expires_at}`}. O <code>url</code> vale 1 hora; depois, baixe por <Link href="#arquivo">GET /v1/media/{"{id}"}</Link>. Áudio vem com a transcrição em <code>transcript</code>.
      </p>
      <p>
        Foto que a IA leu (WhatsApp e Instagram, em chatbot com tamanho de IA) vem com <code>reading</code> {`{type, description, text}`}. Com <code>type</code> <code>comum</code>, <code>description</code> diz o que a foto mostra e <code>text</code> traz o texto escrito nela, sem links, e-mails nem números longos. Os outros tipos não são lidos e vêm sem descrição: <code>comprovante</code> (comprovante de pagamento: a IA nunca confirma pagamento e avisa a equipe), <code>documento</code> (documento pessoal ou cartão), <code>saude</code> (exame, receita ou foto de saúde), <code>impropria</code> e <code>ilegivel</code>. Foto que a IA não leu (modo dados sensíveis, equipe atendendo) vem com <code>reading</code> null.
      </p>

      <Route id="pausar" method="POST" path="/v1/conversations/{id}/pause" />
      <p>
        A pausa é da integração: a equipe não é avisada. A IA volta pelo <Link href="#retomar">resume</Link>, pelo painel, quando alguém da equipe assume ou quando a pausa vence, e responde a última mensagem do contato se ela ficou sem resposta.
      </p>
      <Example page={E} id="pausar" />
      <Example page={E} id="pausar-minutos" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">minutes</code>, "Sem ele, a pausa dura 24 horas e se renova a cada mensagem que você manda pela API nessa conversa. Com ele, de 1 a 10.080 (7 dias), sem renovar.", <>400 <code>minutes</code></>],
          [<code key="2">announce</code>, <><code>true</code>: a primeira mensagem da API sai com a apresentação de quem assumiu, e a volta da IA, com o “Voltei!”.</>, <>400 <code>announce</code></>],
          [<code key="3">agent_name</code>, "O nome na apresentação (até 80 caracteres).", <>400 <code>agent_name</code></>],
        ]}
      />

      <Route id="retomar" method="POST" path="/v1/conversations/{id}/resume" />
      <p>
        Devolve a conversa para a IA na hora (<code>announce</code> opcional, como na pausa). Sai o webhook <code>handoff.returned</code> com <code>reason</code> <code>api</code>.
      </p>
      <Example page={E} id="retomar" />

      <Route id="arquivo" method="GET" path="/v1/media/{id}" />
      <p>
        O arquivo decifrado, com <code>Content-Type</code> e <code>Content-Disposition</code>. Depois do prazo de guarda (ou da exclusão dos dados), 410 <code>media_gone</code>.
      </p>
      <Example page={E} id="arquivo" />

      <H2 id="aceite">Aceite do negócio</H2>
      <p>
        No WhatsApp e no Instagram, as conversas de um negócio só saem pela API depois que ele fez o aceite do canal (na conexão). Antes disso: 403 <code>feature_suspended</code> com <code>details.feature</code> <code>business_acceptance</code>.
      </p>

      <NextSteps
        items={[
          { href: "/docs/api/mensagens", title: "Mensagens", text: "Responda na conversa pausada." },
          { href: "/docs/webhooks", title: "Webhooks", text: "message.received e handoff.* em tempo real." },
        ]}
      />
    </DocPage>
  );
}
