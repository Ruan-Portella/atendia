import Link from "next/link";
import { Access, Code, DocPage, Example, NextSteps, Note, Route, Table } from "@/components/docs/doc";

export const metadata = { title: "Cobrança · API" };

const E = "cobranca";

const PATCH_SIZE = `
PATCH /v1/bots/bot_7c9e6679-7425-40de-944b-e07fc1f90ae7
Idempotency-Key: troca-bar-do-ze-2026-10-19

{ "size": "G", "overage": { "enabled": true, "cap_brl": 150 } }

→ 200: o uso (como acima) e a troca
  "size_change": { "status": "applied", "size": "G", "volume_packs": null, "charged_brl": 32.26, "next_invoice_brl": 0 }

→ 402 payment_required: o cartão recusou; details.invoice_url é a fatura para pagar
  (o tamanho novo vale quando ela for paga)
`;

/** /docs/api/cobranca: uso, tamanho, excedente e crédito (código em src/lib/api-billing.ts). */
export default function BillingApiDocs() {
  return (
    <DocPage eyebrow="Documentação · API" title="Cobrança" intro="O uso do mês de cada chatbot, o tamanho, o excedente e o crédito da conta, com as mesmas regras do painel. Para plataformas que cobram as lojas do jeito delas.">
      <Access permission="billing" extra={<>só o dono da conta cria chave com ela; o crédito pede uma chave com escopo da conta inteira</>} />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#uso"><code>GET /v1/bots/{"{id}"}/usage</code></Link>, "Tamanho, cota e uso do mês, projeção, tamanho sugerido, troca agendada e excedente."],
          [<Link key="2" href="#tamanho"><code>PATCH /v1/bots/{"{id}"}</code></Link>, "Troca o tamanho e liga, desliga ou muda o teto do excedente."],
          [<Link key="3" href="#credito"><code>GET /v1/credit</code></Link>, "O saldo, os lotes que ainda valem e a recarga automática."],
          [<Link key="4" href="#comprar"><code>POST /v1/credit/purchases</code></Link>, "Compra crédito no cartão da assinatura."],
        ]}
      />
      <Note title="Estas rotas cobram">Subir de tamanho e comprar crédito cobram na hora, no cartão da assinatura da conta. A primeira assinatura é feita no painel.</Note>

      <Route id="uso" method="GET" path="/v1/bots/{id}/usage" />
      <p>
        <code>status</code> é a fase do mês: <code>cota</code> (dentro da cota), <code>excedente</code> (a cota acabou e o excedente está ligado, até o teto) ou <code>parado</code> (acabaram a cota e o excedente, ou ele está desligado). <code>projection</code> é a projeção até o fim do mês e <code>average_3_months</code> a média dos meses anteriores com atendimento. <code>suggested_size</code> aparece quando outro tamanho sairia mais barato; <code>scheduled</code>, quando há troca marcada para o dia 1º.
      </p>
      <Example page={E} id="uso" />

      <Route id="tamanho" method="PATCH" path="/v1/bots/{id}" />
      <p>
        A regra é a do painel. Subir de tamanho vale na hora e cobra a diferença proporcional até o dia 1º no cartão da assinatura (abaixo de R$ 1, ela vai para a fatura do dia 1º); descer ou tirar o tamanho fica agendado para o dia 1º (<code>size_change.status</code> <code>scheduled</code>), e mandar o tamanho atual cancela o agendado.
      </p>
      <Example page={E} id="excedente" />
      <Code lang="http · trocar o tamanho" code={PATCH_SIZE} />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="0">Idempotency-Key</code>, <>Obrigatório com <code>size</code> (subir cobra na hora).</>, <>400 <code>Idempotency-Key</code></>],
          [<code key="1">size</code>, <><code>atendimento</code> (sem IA), <code>P</code>, <code>M</code>, <code>G</code>, <code>volume</code> ou <code>null</code> (sem tamanho).</>, <>400 <code>size</code></>],
          [<code key="2">volume_packs</code>, <>Só com <code>{`size: "volume"`}</code>: de 1 a 1.000.</>, <>400 <code>volume_packs</code></>],
          [<code key="3">overage</code>, <><code>{"{enabled, cap_brl?}"}</code>: <code>enabled</code> obrigatório; <code>cap_brl</code> de 10 a 100.000 reais por mês (null: sem teto; sem o campo, o teto fica como está). Só em chatbot com tamanho de IA.</>, <>400 <code>overage…</code>; 422 <code>overage_not_available</code></>],
          ["outros campos", <>Não são aceitos: mande <code>size</code>, <code>volume_packs</code> e/ou <code>overage</code>.</>, <>400 com o campo</>],
        ]}
      />
      <Table
        head={["Erro", "Quando"]}
        rows={[
          [<code key="1">402 payment_required</code>, <>O cartão recusou a subida; <code>details.invoice_url</code> é a fatura (o tamanho novo vale quando ela for paga).</>],
          [<code key="2">402 payment_overdue</code>, "O último pagamento da assinatura está em aberto."],
          [<code key="3">409 conflict</code>, "Uma subida anterior deste chatbot acabou de ser paga e já valeu: confira o uso e mande de novo, se precisar."],
          [<code key="4">422 subscription_required</code>, "A conta ainda não tem assinatura (a primeira é feita no painel)."],
          [<code key="5">422 custom_quota</code>, "O chatbot tem cota sob medida combinada com a BoaVoz."],
        ]}
      />

      <Route id="credito" method="GET" path="/v1/credit" />
      <p>
        O crédito é da conta e paga o excedente dos chatbots. Cada compra vira um lote que vale 12 meses; o que vence antes é usado primeiro.
      </p>
      <Example page={E} id="credito" />

      <Route id="comprar" method="POST" path="/v1/credit/purchases" />
      <Example page={E} id="comprar" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="0">Idempotency-Key</code>, "Cabeçalho obrigatório (uma chave por compra: repetir não compra de novo).", <>400 <code>Idempotency-Key</code></>],
          [<code key="1">amount_brl</code>, "De 50 a 50.000, em reais inteiros.", <>400 <code>amount_brl</code></>],
        ]}
      />
      <p>
        Cartão recusado: 402 <code>payment_required</code> com <code>details.invoice_url</code>; o crédito entra quando a fatura for paga. O crédito não é reembolsável.
      </p>
      <p>
        Numa plataforma, o restaurante liga o excedente no painel dela, ela liga pela API e cobra o restaurante como quiser a partir do <Link href="/docs/webhooks#cobranca">fechamento do mês</Link> (<code>bot.month_closed</code>). O BoaVoz nunca cobra o restaurante: o crédito é da conta da plataforma.
      </p>

      <NextSteps
        items={[
          { href: "/docs/webhooks#cobranca", title: "Webhooks de cobrança", text: "Cota no fim, excedente, fechamento do mês e crédito baixo." },
          { href: "/docs/api", title: "Chave, convenções e erros", text: "Idempotency-Key, paginação e o formato dos erros." },
        ]}
      />
    </DocPage>
  );
}
