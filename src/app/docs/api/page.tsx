import Link from "next/link";
import { Code, DocPage, H2, H3, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Chave, convenções e erros · API" };

const AUTH = `
curl "https://boavoz.com/api/v1/conversations?limit=20" \\
  -H "Authorization: Bearer $BOAVOZ_API_KEY"
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

/** Referência da API pública /api/v1: o que vale para todas as rotas (spec Peças 3, 4, 7 e "Formatos de payload"). */
export default function ApiDocs() {
  return (
    <DocPage
      eyebrow="Documentação · API"
      title="API do BoaVoz"
      intro="Enviar mensagens e campanhas, ler conversas, contatos e leads, pausar a IA numa conversa, ligar contatos às contas do seu sistema e cuidar da cobrança dos chatbots. Esta página tem o que vale para todas as rotas; cada assunto tem a página dele, com os exemplos."
    >
      <H2 id="autenticacao">Endereço e chave</H2>
      <p>
        Base: <code>https://boavoz.com/api/v1</code> (a API não responde no domínio próprio das agências). Toda requisição leva a chave no cabeçalho <code>Authorization: Bearer</code>. Nos exemplos, a chave fica na variável de ambiente <code>BOAVOZ_API_KEY</code>.
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
          <strong>Permissões</strong>, uma por assunto:
        </li>
      </ul>
      <Table
        head={["Permissão", "Abre"]}
        rows={[
          [<code key="m">messages</code>, <Link key="l" href="/docs/api/mensagens">Enviar mensagens, ler uma mensagem e listar os modelos do número.</Link>],
          [<code key="c">conversations</code>, <Link key="l" href="/docs/api/conversas">Listar conversas e mensagens, baixar arquivos, pausar e devolver a IA.</Link>],
          [<code key="ct">contacts</code>, <Link key="l" href="/docs/api/contatos">Contatos, leads, etiquetas, idade e o pedido de exclusão do titular.</Link>],
          [<code key="cp">campaigns</code>, <Link key="l" href="/docs/api/campanhas">Campanhas e lembretes, e registrar o aceite de novidades.</Link>],
          [<code key="p">pairing</code>, <Link key="l" href="/docs/api/pareamento">Pareamento: ligar o contato à conta dele no seu sistema.</Link>],
          [<code key="s">sources</code>, <Link key="l" href="/docs/api/fontes">Fontes de conhecimento: texto, página ou PDF, com o contexto de cada cliente.</Link>],
          [<code key="pv">provisioning</code>, <Link key="l" href="/docs/api/provisionamento">Clientes e chatbots a partir de um modelo, com o contexto e os dados de cada loja, links de conexão, canais e pausa (pacote Plataforma).</Link>],
          [<code key="mb">members</code>, <Link key="l" href="/docs/api/provisionamento#equipe">A equipe do portal de cada cliente. Vem desmarcada: o portal mostra e exporta conversas.</Link>],
          [<code key="b">billing</code>, <Link key="l" href="/docs/api/cobranca">Uso, tamanho e excedente de cada chatbot, e o crédito da conta. Pode cobrar no cartão da assinatura: só o dono da conta cria chave com ela.</Link>],
        ]}
      />
      <Note>Dê a cada integração só as permissões e o escopo de que ela precisa, e nunca use a chave no navegador ou num app: ela vale para tudo o que o escopo alcança.</Note>
      <p>
        A API é do pacote <strong>Integrações</strong> (R$ 49 por mês, por conta). Sem ele, a chave continua guardada e toda rota responde <code>403 plan_not_allowed</code>.
      </p>

      <H2 id="convencoes">Convenções</H2>
      <ul>
        <li>JSON nos dois sentidos; corpo de até 32 KB.</li>
        <li>
          Ids com prefixo: <code>bot_</code>, <code>cli_</code>, <code>conv_</code>, <code>ctc_</code> (contato), <code>msg_</code>, <code>med_</code> (arquivo), <code>lead_</code>, <code>cmp_</code> (campanha), <code>lnk_</code> (vínculo), <code>mbr_</code> (pessoa da equipe).
        </li>
        <li>
          <strong>Limite:</strong> 50 requisições a cada 5 segundos por chave. Passou disso: 429 <code>rate_limited</code> com <code>Retry-After</code>.
        </li>
        <li>
          <strong>Paginação:</strong> <code>limit</code> de 1 a 100 (padrão 50) e <code>cursor</code> = o <code>next_cursor</code> da resposta anterior (null na última página).
        </li>
        <li>
          <strong>Idempotency-Key</strong> (opcional nos envios; obrigatória em campanhas, na criação de chatbot, na troca de tamanho e na compra de crédito): vale 24 horas por chave de API. A mesma chave com o mesmo corpo devolve a resposta guardada, sem fazer de novo, com o cabeçalho <code>Idempotent-Replayed: true</code>; com outro corpo, 409 <code>idempotency_conflict</code>. Erro de validação, 429 e 5xx não ficam guardados: dá para repetir com a mesma chave.
        </li>
      </ul>
      <H3 id="contato">Endereço do contato</H3>
      <p>
        Onde a rota pede um contato (<code>to</code>, <code>{"{contact}"}</code>, <code>contact</code>), vale qualquer um destes formatos:
      </p>
      <Table
        head={["Formato", "Quem"]}
        rows={[
          [<code key="1">ctc_…</code>, "O id do contato no BoaVoz."],
          [<code key="2">phone:5511999990000</code>, "O número no WhatsApp (com o 55)."],
          [<code key="3">wa:&lt;BSUID&gt;</code>, "O id de usuário do WhatsApp, quando a Meta não manda o telefone."],
          [<code key="4">ig:&lt;id&gt;</code>, "O id da pessoa no Instagram (IGSID)."],
          [<code key="5">ext:&lt;id&gt;</code>, <>O id da pessoa no seu sistema (depois do <Link href="/docs/api/pareamento">pareamento</Link>). No envio, pede <code>channel</code>.</>],
        ]}
      />

      <H2 id="erros">Erros</H2>
      <p>
        Todo erro vem no mesmo formato. <code>details.field</code> aponta o campo com problema; cada página da API lista as regras e os erros dos campos das rotas dela.
      </p>
      <Code lang="json" code={ERROR} />
      <Table
        head={["HTTP", "code", "Quando"]}
        rows={[
          ["400", <code key="1">invalid_request</code>, <>Campo com problema; <code>details.field</code> aponta qual.</>],
          ["401", <code key="2">invalid_api_key</code>, "Chave ausente, inválida ou revogada."],
          ["402", <><code>payment_required</code>, <code>payment_overdue</code></>, <>O cartão da assinatura recusou a cobrança (<code>details.invoice_url</code> é a fatura para pagar; vale quando ela for paga), ou o último pagamento da assinatura está em aberto.</>],
          ["403", <code key="3">forbidden_scope</code>, "A chave não tem a permissão da rota, o chatbot está fora do escopo dela (ou, no crédito e na criação de cliente, ela não vale para a conta inteira)."],
          ["403", <code key="fl">field_locked</code>, "O campo do chatbot é travado pelo modelo dele (só os campos que o modelo libera aceitam valor próprio)."],
          ["403", <><code>plan_not_allowed</code>, <code>feature_suspended</code></>, "A conta não tem o pacote do recurso (a API e a identificação são do pacote Integrações; clientes e chatbots pela API, do Plataforma), ele está suspenso na conta, o canal está suspenso, ou o negócio ainda não fez o aceite do canal."],
          ["404", <code key="5">not_found</code>, "Não existe ou está fora do escopo da chave."],
          ["409", <><code>idempotency_conflict</code>, <code>conflict</code></>, "Idempotency-Key repetida com outro corpo (ou a primeira ainda está em andamento); ou uma subida anterior do chatbot acabou de ser paga (confira e mande de novo)."],
          ["410", <code key="7">media_gone</code>, "O arquivo passou do prazo de guarda ou foi apagado."],
          ["422", <><code>outside_messaging_window</code>, <code>channel_not_connected</code>, <code>bot_paused</code>, <code>bot_without_size</code>, <code>contact_suppressed</code>, <code>contact_opted_out</code>, <code>no_marketing_consent</code>, <code>template_category_mismatch</code>, <code>empty_audience</code>, <code>channel_rejected</code></>, "Regra do canal ou do contato: o BoaVoz confere antes de chamar a Meta e diz o motivo."],
          ["422", <><code>subscription_required</code>, <code>custom_quota</code>, <code>overage_not_available</code></>, "Cobrança: a conta ainda não tem assinatura (a primeira é feita no painel), o chatbot tem cota sob medida combinada com a BoaVoz, ou o excedente pedido num chatbot sem tamanho de IA."],
          ["422", <code key="9">prohibited_content</code>, <>O portão barrou o texto ou um título (a API nunca edita). <code>details</code> traz o motivo, os trechos e o canal.</>],
          ["429", <code key="10">rate_limited</code>, <>Limite da chave ou do número; espere o <code>Retry-After</code>.</>],
          ["503", <code key="11">channel_unavailable</code>, <>O WhatsApp ou o Instagram está instável; tente de novo depois do <code>Retry-After</code>.</>],
        ]}
      />

      <H2 id="assuntos">Os assuntos</H2>
      <NextSteps
        items={[
          { href: "/docs/api/mensagens", title: "Mensagens", text: "Texto, modelo, imagem e documento no WhatsApp, no Instagram e no site." },
          { href: "/docs/api/conversas", title: "Conversas e pausa", text: "Conversas, histórico, arquivos, e pausar a IA para o seu sistema responder." },
          { href: "/docs/api/contatos", title: "Contatos e leads", text: "Sincronizar contatos, etiquetas, idade, leads e o pedido do titular." },
          { href: "/docs/api/campanhas", title: "Campanhas e aceite", text: "Campanhas de novidades, lembretes e o aceite de novidades." },
          { href: "/docs/api/pareamento", title: "Pareamento", text: "Ligar o contato à conta dele no seu sistema." },
          { href: "/docs/api/fontes", title: "Fontes", text: "Texto, página ou PDF, e o documento de cada cliente com o contexto." },
          { href: "/docs/api/provisionamento", title: "Lojas pela API", text: "Clientes e chatbots a partir de um modelo, pelo seu sistema." },
          { href: "/docs/api/cobranca", title: "Cobrança", text: "Uso do mês, tamanho, excedente e crédito." },
        ]}
      />
      <p>
        Prefere testar no Postman? <a href="/docs/postman/boavoz-api.postman_collection.json">Baixe a coleção</a> e <a href="/docs/postman/boavoz.postman_environment.json">o ambiente</a> (preencha <code>api_key</code>, <code>bot_id</code> e <code>phone</code>). Os exemplos destas páginas saem da mesma fonte da coleção.
      </p>
    </DocPage>
  );
}
