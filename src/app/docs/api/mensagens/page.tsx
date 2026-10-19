import Link from "next/link";
import { Access, DocPage, Example, H2, H3, NextSteps, Note, Route, Table } from "@/components/docs/doc";

export const metadata = { title: "Mensagens · API" };

const E = "mensagens";

/** /docs/api/mensagens: POST /v1/messages, GET /v1/messages/{id} e os modelos do número (código em src/lib/api-messages.ts). */
export default function MessagesApiDocs() {
  return (
    <DocPage eyebrow="Documentação · API" title="Mensagens" intro="Mande texto, modelo, imagem ou documento para um contato no WhatsApp ou no Instagram, ou para uma conversa do chat do site. O BoaVoz confere tudo o que sabe antes de chamar a Meta e diz o motivo quando não dá.">
      <Access permission="messages" />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#enviar"><code>POST /v1/messages</code></Link>, "Envia texto, modelo, imagem ou documento."],
          [<Link key="2" href="#ler"><code>GET /v1/messages/{"{id}"}</code></Link>, "A mensagem, com o status (sent, delivered, read, failed, uncertain)."],
          [<Link key="3" href="#modelos"><code>GET /v1/bots/{"{id}"}/templates</code></Link>, "Os modelos do número do WhatsApp do chatbot e se dá para enviar cada um pela API."],
        ]}
      />

      <Route id="enviar" method="POST" path="/v1/messages" />
      <p>
        <strong>WhatsApp e Instagram:</strong> <code>bot_id</code> e <code>to</code>, o <Link href="/docs/api#contato">endereço do contato</Link>. <strong>Chat do site:</strong> <code>conversation_id</code>, de uma conversa que o visitante abriu. O <code>type</code> escolhe o resto do corpo.
      </p>
      <Example page={E} id="texto" />
      <Example page={E} id="assinado" />
      <p>
        <code>agent_name</code> faz a mensagem chegar como de alguém da equipe (“*Ana:* …” no WhatsApp); <code>sender</code> é quem mandou no seu sistema e volta no webhook <code>message.sent</code>.
      </p>
      <Example page={E} id="site" />
      <Example page={E} id="imagem" />
      <Example page={E} id="documento" />
      <Example page={E} id="modelo" />
      <p>
        Fora da janela de 24 horas (o contato não escreveu nesse tempo), só sai modelo aprovado. Confira os modelos e o número de variáveis de cada um em <Link href="#modelos">GET /v1/bots/{"{id}"}/templates</Link>.
      </p>
      <Example page={E} id="botoes" />
      <p>
        Botões, lista, link e carrossel vão em <code>components</code>, junto de um texto. O formato e como cada um fica em cada canal estão em <Link href="/docs/mensagens-ricas">Mensagens ricas</Link>.
      </p>

      <H3 id="enviar-campos">Regras e erros dos campos</H3>
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">bot_id</code>, "Obrigatório no WhatsApp e no Instagram: o id com bot_, de um chatbot do escopo da chave.", <code key="e">403 forbidden_scope</code>],
          [<code key="2">to</code>, <>Obrigatório no WhatsApp e no Instagram: <code>ctc_…</code>, <code>phone:55…</code>, <code>wa:&lt;BSUID&gt;</code>, <code>ig:&lt;id&gt;</code> ou <code>ext:&lt;id&gt;</code>. Contato que não existe no chatbot: 404.</>, <>400 <code>to</code></>],
          [<code key="3">channel</code>, <><code>whatsapp</code> ou <code>instagram</code>. Obrigatório com <code>ext:</code>; com os outros formatos, se vier, precisa bater com o do <code>to</code>.</>, <>400 <code>channel</code></>],
          [<code key="4">conversation_id</code>, <>Só no chat do site: <code>conv_…</code>, de uma conversa do site. Não vai junto com <code>to</code>.</>, <>400 <code>conversation_id</code></>],
          [<code key="5">type</code>, <><code>text</code>, <code>template</code>, <code>image</code> ou <code>document</code>. No chat do site, não há modelo.</>, <>400 <code>type</code></>],
          [<code key="6">text</code>, <>Com <code>text</code>: obrigatório, até 4.096 caracteres (com <code>components</code>, até 1.024). Com imagem e documento: a legenda, até 1.024. Com modelo: não mande (o texto vem do modelo).</>, <>400 <code>text</code></>],
          [<><code key="7">image</code>, <code>document</code></>, <><code>{"{url, filename?}"}</code>: <code>url</code> HTTPS pública (até 2.048 caracteres); <code>filename</code> até 200. Imagem: JPEG ou PNG até 5 MB. Documento: PDF, Word, Excel, PowerPoint, TXT ou CSV até 16 MB. No Instagram, PDF e imagem até 8 MB; no site, documento só em PDF. O BoaVoz confere o tipo pelos primeiros bytes.</>, <>400 <code>image.url</code>, <code>document.url</code>, <code>….filename</code></>],
          [<code key="8">template</code>, <><code>{"{name, language?, variables?}"}</code>: o nome de um modelo aprovado do número, o idioma (padrão <code>pt_BR</code>) e uma variável por <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>…, na ordem (até 20, cada uma até 1.024). Só modelos de utilidade e de marketing; o de marketing pede o aceite de novidades.</>, <>400 <code>template.name</code>, <code>template.language</code>, <code>template.variables</code></>],
          [<code key="9">components</code>, <>Botões, lista, link ou carrossel, só com <code>type: text</code> (<Link href="/docs/mensagens-ricas">formato</Link>).</>, <>400 <code>components…</code>; 422 <code>prohibited_content</code></>],
          [<code key="10">agent_name</code>, "Opcional: assina como alguém da equipe (até 80 caracteres).", <>400 <code>agent_name</code></>],
          [<code key="11">sender</code>, "Opcional: quem mandou no seu sistema (até 64: letras, números, espaço, ponto e hífen).", <>400 <code>sender</code></>],
        ]}
      />

      <H3 id="enviar-regras">O que o BoaVoz confere antes de mandar</H3>
      <Table
        head={["Erro", "Quando"]}
        rows={[
          [<code key="1">422 outside_messaging_window</code>, "O contato não escreveu nas últimas 24 horas: no WhatsApp, só modelo; no Instagram, nada."],
          [<code key="2">422 channel_not_connected</code>, "O chatbot não tem o canal conectado, ou o cliente tirou o acesso do BoaVoz (conecte de novo no painel)."],
          [<code key="3">422 bot_paused</code>, "O chatbot está pausado pelo dono: nada sai pela API até ele ser retomado."],
          [<code key="4">422 bot_without_size</code>, "Modelo num chatbot sem tamanho: campanhas, lembretes e modelos só saem de chatbot com tamanho."],
          [<code key="5">422 contact_suppressed</code>, "O contato pediu para apagar os dados: está na lista de supressão."],
          [<code key="6">422 contact_opted_out</code>, "O contato pediu para não receber esse tipo de mensagem (SAIR, botão ou o próprio WhatsApp)."],
          [<code key="7">422 no_marketing_consent</code>, "Modelo de marketing para quem não aceitou novidades (ou disse que não tem 18 anos)."],
          [<code key="8">422 prohibited_content</code>, "O portão barrou o texto, um título ou o modelo pelas regras da Meta (o texto nunca é editado)."],
          [<code key="9">422 channel_rejected</code>, <>A Meta recusou; <code>details.channel_code</code> traz o código dela.</>],
          [<code key="10">403 feature_suspended</code>, "O canal está suspenso, ou o negócio ainda não fez o aceite do canal."],
        ]}
      />
      <ul>
        <li>
          Deu certo: 201 com <code>{`"status": "sent"`}</code>. Sem resposta da Meta no prazo: 202 com <code>{`"status": "uncertain"`}</code>; o status da Meta concilia depois (webhook <code>message.status</code> ou <code>message.failed</code>). O BoaVoz nunca reenvia sozinho: para tentar de novo, use a mesma Idempotency-Key.
        </li>
        <li>Erro temporário da Meta: 503 ou 429 com <code>Retry-After</code>.</li>
      </ul>
      <Example page={E} id="idempotencia" />
      <Note>Repetir com a mesma Idempotency-Key (em até 24 horas) devolve o mesmo <code>message_id</code>, com o cabeçalho <code>Idempotent-Replayed: true</code>, e só uma mensagem chega ao contato.</Note>

      <Route id="ler" method="GET" path="/v1/messages/{id}" />
      <p>
        A mensagem no mesmo formato do <Link href="/docs/api/conversas#historico">histórico</Link>. <code>status</code>: <code>received</code> (do contato), <code>pending</code>, <code>sent</code>, <code>delivered</code>, <code>read</code>, <code>failed</code> (com <code>error.code</code>) ou <code>uncertain</code>. <code>source</code>: <code>contact</code>, <code>ai</code>, <code>human</code> (equipe), <code>api</code>, <code>campaign</code> ou <code>phone_app</code> (o app do celular, na coexistência).
      </p>
      <Example page={E} id="ler" />

      <Route id="modelos" method="GET" path="/v1/bots/{id}/templates" />
      <p>
        Os modelos do número do WhatsApp do chatbot, com a categoria, o status da Meta, o texto e o número de variáveis. <code>sendable</code> diz se dá para mandar pela API (aprovado, de utilidade ou de marketing e num formato que o BoaVoz envia); quando não dá, <code>unsupported_reason</code> diz por quê. Sem WhatsApp conectado: 422 <code>channel_not_connected</code>.
      </p>
      <Example page={E} id="modelos" />

      <H2 id="proximos">Próximos passos</H2>
      <NextSteps
        items={[
          { href: "/docs/mensagens-ricas", title: "Mensagens ricas", text: "Botões, lista, link e carrossel, e como ficam em cada canal." },
          { href: "/docs/webhooks", title: "Webhooks", text: "message.sent, message.status e message.failed no seu sistema." },
        ]}
      />
    </DocPage>
  );
}
