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
      <Access permission="provisioning" platform extra={<>criar cliente pede uma chave com escopo da conta inteira; <code>size</code> e <code>overage</code> pedem também <code>billing</code></>} />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#criar-cliente"><code>POST /v1/clients</code></Link>, <>Cria o cliente (a loja). O <code>external_id</code> torna idempotente.</>],
          [<Link key="2" href="#ler-cliente"><code>GET /v1/clients/{"{id}"}</code></Link>, "Os dados do cliente, os chatbots dele e a conformidade."],
          [<Link key="3" href="#criar-chatbot"><code>POST /v1/bots</code></Link>, "Cria o chatbot da loja a partir de um modelo, com o contexto, os dados da loja e os valores próprios."],
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
          O chat do site da loja usa o <code>widget_key</code> da resposta no código do widget (<code>data-key</code>). O WhatsApp e o Instagram a loja conecta pelo link de conexão, no painel.
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
        A <code>Idempotency-Key</code> é obrigatória (sem ela, <code>400 invalid_request</code>). 201 com <code>bot_id</code> e <code>widget_key</code> (a chave do código do chat do site); 200 quando o <code>external_id</code> já existe no cliente, sem mudar o contexto, o display nem os valores próprios (o tamanho e o excedente são conferidos de novo: repetir depois de um 402 tenta a cobrança de novo, e o 402 traz o <code>bot_id</code> em <code>details</code>). Chave com escopo de chatbots escolhidos não cria chatbot: <code>403 forbidden_scope</code>. Até 300 chatbots novos por hora com a mesma chave.
      </p>
      <Note>
        O que o chatbot herda do modelo muda quando você publica o modelo de novo; o <code>context</code>, o <code>display</code> e os canais são sempre do chatbot. No painel, o contexto e os dados da loja ficam na aba Ações do chatbot.
      </Note>

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
