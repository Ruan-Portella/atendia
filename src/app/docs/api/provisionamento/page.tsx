import Link from "next/link";
import { Access, DocPage, Example, H2, NextSteps, Note, Route, Table } from "@/components/docs/doc";

export const metadata = { title: "Lojas pela API · API" };

const E = "provisionamento";

/** /docs/api/provisionamento: clientes e chatbots pela API, a partir de um modelo (código em src/lib/api-provisioning.ts). */
export default function ProvisioningApiDocs() {
  return (
    <DocPage
      eyebrow="Documentação · API"
      title="Lojas pela API"
      intro="Para quem tem muitas lojas ou clientes parecidos, como uma plataforma de delivery: o seu sistema cria o cliente e o chatbot dele a partir de um modelo, sem passar pelo painel. Cada chatbot já nasce com a personalidade, as ações, os roteiros e a base do modelo, e com o contexto e os dados da loja."
    >
      <Access permission="provisioning" platform extra={<>criar cliente pede uma chave com escopo da conta inteira; <code>size</code> e <code>overage</code> pedem também <code>billing</code>; a equipe do portal pede <code>members</code></>} />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#criar-cliente"><code>POST /v1/clients</code></Link>, <>Cria o cliente (a loja). O <code>external_id</code> torna idempotente.</>],
          [<Link key="2" href="#ler-cliente"><code>GET /v1/clients/{"{id}"}</code></Link>, "Os dados do cliente, os chatbots dele e a conformidade."],
          [<Link key="3" href="#criar-chatbot"><code>POST /v1/bots</code></Link>, "Cria o chatbot da loja a partir de um modelo, com o contexto, os dados da loja e os valores próprios."],
          [<Link key="9" href="#editar"><code>PATCH /v1/bots/{"{id}"}</code></Link>, "Muda os dados da loja, os valores próprios, o horário e o destino do atendimento."],
          [<Link key="4" href="#link"><code>POST /v1/bots/{"{id}"}/connect-links</code></Link>, "O link para a loja conectar o WhatsApp ou o Instagram dela."],
          [<Link key="5" href="#canais"><code>GET /v1/bots/{"{id}"}/channels</code></Link>, "Os canais da Meta do chatbot e o estado de cada um."],
          [<Link key="6" href="#desconectar"><code>DELETE /v1/bots/{"{id}"}/channels/{"{channel}"}</code></Link>, "Desconecta o canal de vez."],
          [<Link key="7" href="#pausar"><code>POST /v1/bots/{"{id}"}/pause</code>, <code>/resume</code></Link>, "Pausa e retoma a IA do chatbot em todos os canais."],
          [<Link key="10" href="#uso"><code>GET /v1/usage</code></Link>, "O uso do mês por cliente e chatbot."],
          [<Link key="8" href="#equipe"><code>POST</code>, <code>GET /v1/clients/{"{id}"}/members</code>, <code>DELETE …/members/{"{member}"}</code></Link>, <>A equipe da loja no portal (permissão <code>members</code>).</>],
        ]}
      />

      <H2 id="caminho">O caminho de uma loja nova</H2>
      <ol>
        <li>
          No painel, monte o <strong>modelo</strong> (menu Modelos): a personalidade, as instruções, as ações, os roteiros e a base comuns a todas as lojas. Publique. O id do modelo para a API está na aba Herança.
        </li>
        <li>
          <Link href="#criar-cliente"><code>POST /v1/clients</code></Link> com o id da loja no seu sistema (<code>external_id</code>).
        </li>
        <li>
          <Link href="#criar-chatbot"><code>POST /v1/bots</code></Link> com o cliente, o modelo, o <code>context</code> (por exemplo <code>{'{"loja_id": "42"}'}</code>, que vai para as ações) e o <code>display</code> (o nome e o horário da loja, para a IA).
        </li>
        <li>
          O chat do site da loja usa o <code>widget_key</code> da resposta no código do widget (<code>data-key</code>). Para o WhatsApp e o Instagram, peça o <Link href="#link">link de conexão</Link> e mostre no painel da loja: ela abre e conecta com a conta dela na Meta.
        </li>
      </ol>
      <Note>
        Repetir é seguro: o mesmo <code>external_id</code> devolve o cliente ou o chatbot que já existe, com 200, sem criar outro. Assim, o provisionamento que falhou no meio pode rodar de novo do começo.
      </Note>

      <Route id="criar-cliente" method="POST" path="/v1/clients" />
      <Example page={E} id="cliente" />
      <Example page={E} id="cliente-de-novo" />
      <Example page={E} id="cliente-lembretes" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">name</code>, "O nome do cliente, de 2 a 80 caracteres.", <>400 <code>name</code></>],
          [<code key="2">external_id</code>, "Obrigatório: o id do cliente no seu sistema, até 120 caracteres. Único na conta.", <>400 <code>external_id</code></>],
          [<code key="3">site</code>, "Opcional: o endereço do site (até 200 caracteres).", <>400 <code>site</code></>],
          [<code key="4">utility_consent</code>, <>Opcional: a declaração de consentimento para lembretes, como no painel: <code>source</code> (<code>cadastro</code>, <code>contrato</code>, <code>compra</code> ou <code>outro</code>) e <code>text</code> (de 20 a 1.000 caracteres: como os contatos aceitaram). A chave fica como autora; revogar a chave não revoga a declaração.</>, <>400 <code>utility_consent.source</code> ou <code>.text</code></>],
        ]}
      />
      <p>
        201 com <code>client_id</code> e <code>compliance_status</code> (<code>active</code>, <code>review</code> ou <code>blocked</code>; o cliente novo começa ativo). O <code>external_id</code> que já existe na conta devolve o mesmo cliente com 200, sem mudar nada. Com chave de escopo menor que a conta inteira: <code>403 forbidden_scope</code>. Até 300 clientes novos por hora com a mesma chave. Aceita <Link href="/docs/api#convencoes">Idempotency-Key</Link>.
      </p>

      <Route id="ler-cliente" method="GET" path="/v1/clients/{id}" />
      <Example page={E} id="ler-cliente" />
      <p>
        <code>bots</code> traz os chatbots do cliente que a chave alcança, com o <code>external_id</code>, o status, a pausa, o modelo e os canais da Meta conectados (<code>whatsapp</code>, <code>instagram</code>; o chat do site vale sempre). <code>compliance</code> traz o estado e as restrições em vigor, com o motivo resumido e o próximo passo, iguais aos do webhook <code>compliance.changed</code>. Esta rota nunca responde <code>feature_suspended</code>: ela é como você fica sabendo do que está suspenso.
      </p>

      <Route id="criar-chatbot" method="POST" path="/v1/bots" />
      <Example page={E} id="chatbot" />
      <Example page={E} id="chatbot-proprio" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">client_id</code>, <>Obrigatório: o <code>cli_…</code> do <code>POST /v1/clients</code>. Com chave de escopo de um cliente, só o cliente dela.</>, <>400 <code>client_id</code>; 404</>],
          [<code key="2">template_id</code>, <>Obrigatório: o modelo (<code>bot_…</code>, na aba Herança dele). O chatbot usa a versão publicada em vigor.</>, <>400 <code>template_id</code>; 404 <code>template_id</code></>],
          [<code key="3">external_id</code>, <>Opcional: o id do chatbot no seu sistema, até 120 caracteres, único no cliente. Com ele, repetir devolve o mesmo chatbot (200).</>, <>400 <code>external_id</code></>],
          [<code key="4">context</code>, <>Opcional: o contexto fixo, até 10 pares (chaves de letras, números, _, . e -; valores texto, número ou verdadeiro/falso). Vai em toda chamada de ação e escolhe as <Link href="/docs/api/fontes">fontes com a mesma etiqueta</Link>. A IA não vê.</>, <>400 <code>context</code></>],
          [<code key="5">display</code>, <>Opcional: o que a IA sabe da loja além da base, como o nome da unidade, o horário e o endereço, no mesmo formato do <code>context</code>. Entra como dado (nunca como instrução) e não vai para as ações.</>, <>400 <code>display</code></>],
          [<code key="6">overrides</code>, <>Opcional: valores próprios, só nos campos que o modelo libera: <code>assistant_name</code> (2 a 40), <code>welcome</code> (até 300), <code>appearance</code> (<code>color</code> #rrggbb, <code>avatar_text</code>, <code>suggested_questions</code> até 6, <code>position</code> left ou right, <code>offset</code> 0 a 200), <code>handoff_notice</code> (com <code>{"{atendente}"}</code>) e <code>extra_instructions</code> (até 4.000, somadas às do modelo).</>, <>403 <code>field_locked</code>; 400 <code>overrides.…</code></>],
          [<><code>size</code>, <code>overage</code></>, <>Opcionais, com a permissão <code>billing</code> também: o tamanho e o excedente, com as regras do <Link href="/docs/api/cobranca">PATCH da cobrança</Link> (subir cobra no cartão da assinatura). Sem <code>size</code>, o chatbot nasce sem tamanho, como no painel.</>, <>403 <code>forbidden_scope</code>; 402; 422</>],
        ]}
      />
      <p>
        A <code>Idempotency-Key</code> é obrigatória (sem ela, <code>400 invalid_request</code>). 201 com <code>bot_id</code> e <code>widget_key</code> (a chave do código do chat do site). O chatbot nasce no ar (<code>&quot;status&quot;: &quot;live&quot;</code>) quando o modelo tem pelo menos uma fonte pronta, a mesma regra do Publicar do painel; sem fonte, nasce em rascunho (<code>draft</code>) e vai ao ar pelo Publicar, no painel. O mesmo <code>external_id</code> dá 200 quando ele já existe no cliente, sem mudar o contexto, o display nem os valores próprios (o tamanho e o excedente são conferidos de novo: repetir depois de um 402 tenta a cobrança de novo, e o 402 traz o <code>bot_id</code> em <code>details</code>). Chave com escopo de chatbots escolhidos não cria chatbot: <code>403 forbidden_scope</code>. Até 300 chatbots novos por hora com a mesma chave.
      </p>
      <Note>
        O que o chatbot herda do modelo muda quando você publica o modelo de novo; o <code>context</code>, o <code>display</code> e os canais são sempre do chatbot. No painel, o contexto e os dados da loja ficam na aba Ações do chatbot.
      </Note>

      <Route id="editar" method="PATCH" path="/v1/bots/{id}" />
      <Example page={E} id="editar" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">display</code>, <>Os dados da loja para a IA, como no <Link href="#criar-chatbot">POST</Link>; null tira.</>, <>400 <code>display</code></>],
          [<code key="2">overrides</code>, <>Só no chatbot criado de um modelo e só nos campos que o modelo libera (os mesmos do POST); null volta ao valor do modelo. A aparência parte da que o chatbot tem agora.</>, <>403 <code>field_locked</code>; 400 <code>overrides…</code></>],
          [<code key="3">business_hours</code>, <>O horário do atendimento humano, de <code>sun</code> a <code>sat</code>: <code>[&quot;18:00&quot;, &quot;23:00&quot;]</code> ou null (fechado), no horário de Brasília. Substitui o horário inteiro; null tira. Fora dele, o assistente diz quando a equipe volta.</>, <>400 <code>business_hours.…</code></>],
          [<code key="4">handoff_destination</code>, <>Os outros jeitos de falar com a equipe, que o assistente oferece quando a pessoa pede um atendente: <code>email</code>, <code>phone</code>, <code>site</code>, <code>form_url</code> e <code>address</code>. Só muda o que vier; null tira. Toda troca manda um alerta de segurança ao dono da conta.</>, <>400 <code>handoff_destination.…</code></>],
        ]}
      />
      <p>
        Permissão <code>provisioning</code>; a resposta é o chatbot. O tamanho e o excedente (<code>size</code>, <code>overage</code>) vão no mesmo <code>PATCH</code>, com a permissão <code>billing</code>, em outro pedido (os dois juntos: 400), como na <Link href="/docs/api/cobranca">Cobrança</Link>. O contexto fixo, o modelo, as ações, os roteiros e a publicação ficam no painel: o que muda para onde vão os dados fica com quem cuida da conta. O modelo não aceita este <code>PATCH</code> (ele muda no painel e chega aos derivados ao publicar).
      </p>

      <Route id="link" method="POST" path="/v1/bots/{id}/connect-links" />
      <Example page={E} id="link" />
      <p>
        <code>channel</code> é <code>whatsapp</code> ou <code>instagram</code>. Enquanto houver um link aberto (vale 7 dias e serve para uma conexão), pedir de novo devolve o mesmo; <code>rotate: true</code> cria outro e o anterior deixa de valer. A página do link sai com a marca da sua conta, no domínio do BoaVoz (a Meta só abre o login nos domínios do app), e antes da conexão pede o aceite do próprio negócio. Com o canal já conectado, o link serve para conectar de novo: o número novo substitui o antigo (<code>channel_connected</code> e <code>connected_channel</code> dizem o que está conectado agora).
      </p>
      <p>
        Como no painel, o canal pede um chatbot com tamanho (sem ele, <code>422 bot_without_size</code>), e o canal precisa estar liberado na conta (senão, <code>403 feature_suspended</code>). O modelo não tem canais (400).
      </p>

      <Route id="canais" method="GET" path="/v1/bots/{id}/channels" />
      <Example page={E} id="canais" />
      <p>
        Cada canal com o <code>id</code> (o mesmo dos webhooks <code>channel.*</code>), o número ou o @ da conta, o <code>status</code> (<code>connected</code> ou <code>disconnected</code>, quando caiu, com o motivo em <code>reason</code>) e o problema em aberto em <code>issue</code> (hoje, a conta do WhatsApp sem forma de pagamento na Meta, código 131042). O chat do site vale sempre e não aparece aqui.
      </p>

      <Route id="desconectar" method="DELETE" path="/v1/bots/{id}/channels/{channel}" />
      <Example page={E} id="desconectar" />
      <p>
        É o &quot;desconectar de vez&quot; do painel: o BoaVoz deixa de receber as mensagens daquela conta e apaga o acesso. Nada muda na Meta: o número e a conta continuam do negócio, e o número nunca é descadastrado. As conversas antigas ficam. Até 5 desconexões por hora com a mesma chave (<code>429 rate_limited</code>), e o dono da conta recebe um alerta de segurança em cada uma. Para parar a IA sem desconectar, use a <Link href="#pausar">pausa</Link>.
      </p>

      <Route id="pausar" method="POST" path="/v1/bots/{id}/pause" />
      <Example page={E} id="pausar" />
      <p>
        A mesma pausa do botão de emergência do painel: a IA e os envios param em todos os canais, os canais continuam conectados e as mensagens continuam gravadas, para a equipe responder pelo painel e pelo portal. Serve para loja fechada, contrato suspenso ou inadimplência com a sua plataforma. <code>reason</code> (até 200 caracteres) vai no webhook <code>bot.paused</code>; com <code>notify_contacts: true</code>, o contato recebe o aviso de atendimento indisponível uma vez por conversa. Já pausado: devolve o <code>paused_at</code> da pausa que vale, com <code>already_paused: true</code>.
      </p>
      <Route id="retomar" method="POST" path="/v1/bots/{id}/resume" />
      <Example page={E} id="retomar" />
      <p>
        Tira só a pausa do dono (feita pelo painel ou pela API) e sai o webhook <code>bot.resumed</code>. Medidas do BoaVoz e ordens da Meta continuam e voltam em <code>restrictions</code>, no mesmo formato do <code>compliance.changed</code>.
      </p>

      <Route id="uso" method="GET" path="/v1/usage" />
      <Example page={E} id="uso" />
      <p>
        O uso de um mês (<code>month</code>, como <code>2026-10</code>; sem ele, o mês atual, no calendário de São Paulo) por cliente e chatbot do escopo da chave, com os filtros <code>client_id</code> e <code>bot_id</code>: os atendimentos (a unidade da cota: cada 24 horas em que a IA respondeu um contato), as mensagens, os contatos que receberam campanha ou lembrete (não contam na cota) e as mensagens do WhatsApp cobradas pela Meta, com o custo estimado pelo preço de referência. O custo da Meta é só informativo: a Meta cobra direto do negócio. O custo de IA não aparece (é do BoaVoz).
      </p>
      <p>
        Com chave da conta inteira e sem filtro, vem também <code>account</code>: os totais da conta, os atendimentos a mais (excedente) do mês, o valor deles e o saldo de crédito.
      </p>

      <H2 id="equipe">Equipe do portal</H2>
      <p>
        A equipe da loja atende pelo portal do cliente (as conversas dela, com a marca da sua conta). Estas rotas pedem a permissão <code>members</code>, que vem desmarcada ao criar a chave: o portal mostra e exporta conversas, então <code>provisioning</code> sozinha não convida ninguém. A chave alcança os clientes do escopo dela.
      </p>
      <Route id="convidar" method="POST" path="/v1/clients/{id}/members" />
      <Example page={E} id="convidar" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">email</code>, "Obrigatório: a pessoa recebe nele o link de acesso, com a marca da sua conta.", <>400 <code>email</code></>],
          [<code key="2">role</code>, <>Obrigatório: <code>manager</code> (gestor: tudo o que a agência liberou no portal) ou <code>agent</code> (atendente: só as conversas).</>, <>400 <code>role</code></>],
          [<code key="3">display_name</code>, "Opcional: o nome que o contato vê quando a pessoa assume a conversa (até 40 caracteres).", <>400 <code>display_name</code></>],
        ]}
      />
      <p>
        201 com a pessoa e <code>invite_email</code> (<code>sent</code> ou <code>failed</code>: o acesso fica criado mesmo se o e-mail falhar, e a pessoa pode pedir um link na entrada do portal). O mesmo e-mail no cliente devolve a pessoa que já existe, com 200, sem mudar o papel. Até 20 pessoas por cliente (<code>422 plan_limit_reached</code>).
      </p>
      <Note>
        O BoaVoz guarda a chave que convidou cada pessoa. Ao revogar uma chave, a tela das chaves mostra quantas pessoas ela convidou, com &quot;remover todas&quot;. O dono da conta recebe por dia o resumo dos convites pela API e um alerta na hora quando eles passam de 20 em 24 horas.
      </Note>
      <Route id="equipe-lista" method="GET" path="/v1/clients/{id}/members" />
      <Example page={E} id="equipe" />
      <p>
        <code>invited_by</code> é a chave que convidou (o nome e o começo dela), ou null para quem foi convidado pelo painel.
      </p>
      <Route id="remover" method="DELETE" path="/v1/clients/{id}/members/{member}" />
      <Example page={E} id="remover" />
      <p>Tira o acesso na hora: a sessão aberta perde o acesso na próxima página. Responde 204; a pessoa que não é do cliente, 404.</p>

      <NextSteps
        items={[
          { href: "/docs/api/fontes", title: "Fontes", text: "Os documentos de cada loja, com o contexto." },
          { href: "/docs/api/cobranca", title: "Cobrança", text: "O tamanho e o excedente de cada chatbot." },
          { href: "/docs/acoes", title: "Ações", text: "O que as ações recebem do contexto fixo." },
        ]}
      />
    </DocPage>
  );
}
