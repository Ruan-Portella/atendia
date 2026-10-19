import Link from "next/link";
import { Access, DocPage, Example, NextSteps, Note, Route, Table } from "@/components/docs/doc";

export const metadata = { title: "Campanhas e aceite · API" };

const E = "campanhas";

/** /docs/api/campanhas: campanhas, lembretes e o aceite de novidades (código em src/lib/api-campaigns.ts e api-contacts.ts). */
export default function CampaignsApiDocs() {
  return (
    <DocPage eyebrow="Documentação · API" title="Campanhas e aceite" intro="Mande campanhas de novidades e lotes de lembretes pelo WhatsApp, acompanhe os totais e registre o aceite de novidades que a pessoa deu no seu sistema. Os envios saem pelo mesmo motor do painel, com as mesmas conferências.">
      <Access permission="campaigns" />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#criar"><code>POST /v1/campaigns</code></Link>, "Campanha de novidades ou lote de lembretes, com modelo aprovado."],
          [<Link key="2" href="#status"><code>GET /v1/campaigns/{"{id}"}</code></Link>, "O status e os totais."],
          [<Link key="3" href="#aceite"><code>POST /v1/contacts/{"{contact}"}/consent</code></Link>, "Registra o aceite (ou a retirada) de novidades no WhatsApp."],
        ]}
      />
      <p>
        As regras das campanhas (aceite, SAIR, 18+, horário e custo) estão em <Link href="/docs/campanhas">Campanhas e consentimento</Link>.
      </p>

      <Route id="criar" method="POST" path="/v1/campaigns" />
      <p>
        <code>kind</code> <code>marketing</code>: um modelo de marketing para um público (etiquetas, contatos ou ids externos); só recebe quem aceitou novidades (e, com bebida ou remédio, quem confirmou 18 anos). <code>kind</code> <code>utility_reminder</code>: um modelo de utilidade com uma linha por envio, cada uma com o contato, a hora e as variáveis dela. Quem pediu para sair é pulado; o envio confere tudo de novo, como no painel. Idempotency-Key obrigatória: repetir não cria outra campanha.
      </p>
      <Example page={E} id="marketing" />
      <Example page={E} id="lembretes" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="0">Idempotency-Key</code>, "Cabeçalho obrigatório (uma chave por campanha).", <>400 <code>Idempotency-Key</code></>],
          [<code key="1">bot_id</code>, "Obrigatório; o chatbot precisa ter tamanho e WhatsApp conectado.", <><code>403 forbidden_scope</code>; 422 <code>bot_without_size</code>, <code>channel_not_connected</code>, <code>bot_paused</code></>],
          [<code key="2">channel</code>, <>Só <code>whatsapp</code> (o padrão): o Instagram não tem mensagem de marketing.</>, <>400 <code>channel</code></>],
          [<code key="3">kind</code>, <><code>marketing</code> ou <code>utility_reminder</code>. O modelo precisa ser da categoria certa.</>, <>400 <code>kind</code>; 422 <code>template_category_mismatch</code></>],
          [<code key="4">name</code>, "Opcional: o nome no painel (até 120 caracteres).", <>400 <code>name</code></>],
          [<code key="5">template</code>, <><code>{"{name, language?, variables?}"}</code>, de um modelo aprovado do número. Na campanha, cada variável é um texto ou <code>{`{"type": "first_name", "fallback": "cliente"}`}</code> (o primeiro nome do contato), até 20.</>, <>400 <code>template.name</code>, <code>template.variables</code>; 422 <code>prohibited_content</code></>],
          [<code key="6">audience</code>, <>Só no marketing: <code>tags</code> (até 20), <code>contacts</code> (até 10.000 endereços) e <code>external_ids</code> (até 1.000). Pelo menos um. Ninguém apto: 422 <code>empty_audience</code>, com quem ficou de fora em <code>details.excluded</code>.</>, <>400 <code>audience…</code></>],
          [<code key="7">send_at</code>, "Só no marketing, opcional: agenda o envio (ISO 8601 com o fuso, até 60 dias à frente).", <>400 <code>send_at</code></>],
          [<code key="8">regulated</code>, <>Só no marketing, opcional: <code>true</code> quando a campanha fala de bebida alcoólica ou remédio, e ela só vai para quem confirmou 18 anos. O BoaVoz também marca sozinho quando o modelo fala disso.</>, <>400 <code>regulated</code></>],
          [<code key="9">sends</code>, <>Só nos lembretes: até 2.000 linhas <code>{"{contact, send_at, variables}"}</code>. <code>send_at</code> com o fuso, não no passado e até 90 dias à frente; <code>variables</code>, textos de até 200 caracteres sem quebra de linha, tantos quanto o modelo pede.</>, <>400 <code>sends[i].…</code></>],
        ]}
      />
      <p>
        Na resposta, <code>excluded</code> conta quem ficou de fora, por motivo: <code>no_consent</code> (sem aceite de novidades), <code>suppressed</code> (pediu para sair), <code>minor</code> e <code>no_age</code> (18+), <code>country</code>, <code>no_phone</code> e <code>not_contact</code>. <code>estimated_cost_cents</code> é a estimativa da tarifa da Meta.
      </p>
      <Note title="Lembrete para quem nunca conversou com o chatbot">Exige a declaração de consentimento para lembretes do cliente (no painel, aba Campanhas do cliente). Sem ela: 400 com <code>details.field</code> <code>utility_consent</code> e as linhas.</Note>

      <Route id="status" method="GET" path="/v1/campaigns/{id}" />
      <p>
        <code>status</code>: <code>scheduled</code>, <code>sending</code>, <code>paused</code> (com <code>pause_reason</code>), <code>finished</code> ou <code>canceled</code>. Os totais contam enviadas, entregues, lidas, respondidas, falhas, puladas por motivo e descadastros.
      </p>
      <Example page={E} id="status" />

      <Route id="aceite" method="POST" path="/v1/contacts/{contact}/consent" />
      <p>
        Grava o aceite de novidades no WhatsApp com a prova (onde, o texto e quando), e cria o contato se ele ainda não existe. Quem pediu para sair continua fora (<code>opted_out: true</code>): só um novo sim dele no chat tira do descadastro. <code>granted: false</code> retira o aceite e emite o webhook <code>contact.opted_out</code>.
      </p>
      <Example page={E} id="aceite" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">bot_id</code>, "Obrigatório; o chatbot precisa ter WhatsApp conectado.", <><code>403 forbidden_scope</code>; 422 <code>channel_not_connected</code></>],
          [<code key="2">channel</code>, <>Só <code>whatsapp</code> (o padrão). Contato do Instagram: 400.</>, <>400 <code>channel</code>, <code>contact</code></>],
          [<code key="3">granted</code>, <><code>true</code> (aceitou) ou <code>false</code> (retirou).</>, <>400 <code>granted</code></>],
          [<code key="4">source</code>, "Obrigatório: onde a pessoa aceitou ou retirou (3 a 200 caracteres, ex.: cadastro no site).", <>400 <code>source</code></>],
          [<code key="5">text</code>, "Obrigatório: o texto que ela aceitou (10 a 1.000 caracteres).", <>400 <code>text</code></>],
          [<code key="6">collected_at</code>, "Opcional: quando foi (ISO 8601, no passado). Padrão: agora.", <>400 <code>collected_at</code></>],
        ]}
      />
      <p>
        Contato que pediu para apagar os dados: 422 <code>contact_suppressed</code> (só um novo sim dado por ele no chat vale).
      </p>

      <NextSteps
        items={[
          { href: "/docs/campanhas", title: "Campanhas e consentimento", text: "As regras do WhatsApp para marketing e lembretes." },
          { href: "/docs/webhooks", title: "Webhooks", text: "campaign.finished e contact.opted_out no seu sistema." },
        ]}
      />
    </DocPage>
  );
}
