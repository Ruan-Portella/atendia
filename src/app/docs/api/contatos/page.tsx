import Link from "next/link";
import { Access, DocPage, Example, NextSteps, Note, Route, Table } from "@/components/docs/doc";

export const metadata = { title: "Contatos e leads · API" };

const E = "contatos";

/** /docs/api/contatos: contatos, etiquetas, idade, leads e o pedido do titular (código em src/lib/api-contacts.ts e api-age.ts). */
export default function ContactsApiDocs() {
  return (
    <DocPage eyebrow="Documentação · API" title="Contatos e leads" intro="Sincronize os contatos com o seu sistema, troque as etiquetas, mande as datas das réguas, informe a idade conferida por você, leia os leads e atenda o pedido do titular para apagar os dados.">
      <Access permission="contacts" />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#listar"><code>GET /v1/contacts</code></Link>, "Os contatos, na ordem da última alteração (para sincronizar)."],
          [<Link key="2" href="#etiquetas"><code>PUT /v1/contacts/{"{contact}"}/tags</code></Link>, "Troca as etiquetas do contato."],
          [<Link key="6" href="#datas"><code>PATCH /v1/contacts/{"{contact}"}</code></Link>, "Grava o aniversário, a última visita e o próximo horário (as datas das réguas)."],
          [<Link key="3" href="#idade"><code>PUT /v1/contacts/{"{contact}"}/age</code></Link>, "A empresa informa a idade que conferiu."],
          [<Link key="4" href="#leads"><code>GET /v1/leads</code></Link>, "Um lead por contato, com o histórico de pedidos."],
          [<Link key="5" href="#apagar"><code>DELETE /v1/contacts/{"{contact}"}?bot_id=</code></Link>, "Pedido do titular: apaga os dados do contato."],
        ]}
      />
      <p>
        <code>{"{contact}"}</code> é o <Link href="/docs/api#contato">endereço do contato</Link> (<code>ctc_…</code>, <code>phone:…</code>, <code>wa:…</code>, <code>ig:…</code> ou <code>ext:…</code>).
      </p>

      <Route id="listar" method="GET" path="/v1/contacts" />
      <p>
        Na ordem da última alteração: guarde o <code>updated_at</code> do último e use em <code>since</code> na próxima vez. <code>consent.marketing</code> é o aceite de novidades no WhatsApp (<code>none</code>, <code>granted</code>, <code>declined</code> ou <code>revoked</code>); <code>consent.opted_out</code>, o que a pessoa pediu para não receber (<code>marketing</code>, <code>utility</code> ou <code>all</code>); <code>age_confirmed</code>, o 18+ (null: ninguém perguntou); <code>birthday</code>, <code>last_visit_at</code> e <code>appointment_at</code>, as <Link href="#datas">datas das réguas</Link>.
      </p>
      <Example page={E} id="listar" />
      <Table
        head={["Parâmetro", "Regra", "Erro"]}
        rows={[
          [<><code key="1">limit</code>, <code key="2">cursor</code></>, <>Paginação: <code>limit</code> de 1 a 100 (padrão 50) e o <code>next_cursor</code> anterior.</>, <>400 <code>limit</code>, <code>cursor</code></>],
          [<code key="3">bot_id</code>, "Só os contatos deste chatbot.", <code key="e">403 forbidden_scope</code>],
          [<code key="4">channel</code>, <><code>widget</code>, <code>whatsapp</code> ou <code>instagram</code>.</>, <>400 <code>channel</code></>],
          [<code key="5">tag</code>, "Só os com esta etiqueta (até 30 caracteres).", <>400 <code>tag</code></>],
          [<code key="6">since</code>, "Só os alterados desde a data (ISO 8601).", <>400 <code>since</code></>],
        ]}
      />

      <Route id="etiquetas" method="PUT" path="/v1/contacts/{contact}/tags" />
      <p>
        Troca todas as etiquetas (lista vazia apaga). Com <code>ext:</code>, vale para todos os contatos do chatbot com aquele id externo.
      </p>
      <Example page={E} id="etiquetas" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">bot_id</code>, "Obrigatório: o chatbot do contato.", <code key="e">403 forbidden_scope</code>],
          [<code key="2">tags</code>, "Lista de textos, até 20 (vírgula e ponto e vírgula viram espaço). Contato que não existe: 404.", <>400 <code>tags</code></>],
        ]}
      />

      <Route id="datas" method="PATCH" path="/v1/contacts/{contact}" />
      <p>
        As datas que as réguas do WhatsApp usam: o aniversário, a última visita ou compra (“faz tempo que você não vem” e o pós-atendimento) e o próximo horário marcado (o lembrete antes do horário). O campo que não vem não muda; <code>null</code> apaga. Pelo telefone (<code>phone:…</code>), cria o contato do WhatsApp que ainda não existe: o horário costuma chegar antes da primeira mensagem. Com <code>ext:</code>, vale para todos os contatos do chatbot com aquele id externo. A resposta traz os contatos alterados.
      </p>
      <Example page={E} id="datas" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">bot_id</code>, "Obrigatório: o chatbot do contato.", <code key="e">403 forbidden_scope</code>],
          [<code key="2">birthday</code>, <>Mês e dia, <code>MM-DD</code> (ex.: <code>10-21</code>). A data inteira (<code>AAAA-MM-DD</code>) também vale, mas o ano não é guardado.</>, <>400 <code>birthday</code></>],
          [<code key="3">last_visit_at</code>, <>A última visita ou compra: data (<code>AAAA-MM-DD</code>) ou data e hora ISO 8601 com fuso. Não pode ser no futuro.</>, <>400 <code>last_visit_at</code></>],
          [<code key="4">appointment_at</code>, <>O próximo horário marcado: data e hora ISO 8601 com fuso (ex.: <code>2026-12-20T14:30:00-03:00</code>), até um ano à frente.</>, <>400 <code>appointment_at</code></>],
          [<code key="5">dates</code>, <>As datas novas das suas réguas (régua personalizada), pela chave de cada uma: <code>{"{ \"renovacao_do_plano\": \"2027-03-10\" }"}</code>. A data é <code>AAAA-MM-DD</code>; <code>null</code> apaga. A chave nasce com a régua que tem a data nova, no painel; as outras chaves do contato ficam.</>, <>400 <code>dates.&lt;chave&gt;</code></>],
          ["Nenhum dos quatro", "Mande pelo menos um.", <>400 <code>birthday</code></>],
          ["Contato que não existe", <>Com <code>ctc_</code>, <code>wa:</code>, <code>ig:</code> ou <code>ext:</code>: o contato precisa existir.</>, <code key="n">404 not_found</code>],
        ]}
      />

      <Route id="idade" method="PUT" path="/v1/contacts/{contact}/age" />
      <p>
        Para quem vende bebida alcoólica ou remédio: o BoaVoz só mostra esses itens para quem tem 18 anos confirmados. Um “Não” dado pela pessoa no chat sempre vence o que a empresa informar (<code>age_confirmed_source</code> <code>chat</code>). A data de nascimento daqui nunca é guardada; para a régua do aniversário, mande o dia e o mês em <Link href="#datas"><code>birthday</code></Link>.
      </p>
      <Example page={E} id="idade" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">bot_id</code>, "Obrigatório.", <code key="e">403 forbidden_scope</code>],
          [<><code key="2">age_verified</code> ou <code key="3">birth_date</code></>, <><code>age_verified</code> <code>true</code> ou <code>false</code>, ou <code>birth_date</code> (AAAA-MM-DD, no passado). Com os dois, eles precisam bater.</>, <>400 <code>age_verified</code>, <code>birth_date</code></>],
          [<code key="4">origin</code>, "Obrigatório: como a idade foi conferida (3 a 300 caracteres).", <>400 <code>origin</code></>],
        ]}
      />

      <Route id="leads" method="GET" path="/v1/leads" />
      <p>
        Um lead por contato em cada chatbot, do mais antigo para o mais novo: nome, telefone, e-mail, o pedido mais recente (<code>notes</code>) e o histórico (<code>requests</code>). Filtros: <code>bot_id</code>, <code>channel</code>, <code>since</code> (criados desde a data) e <code>updated_since</code> (os que mudaram desde a data: pedido novo ou contato); o webhook <code>lead.updated</code> avisa na hora.
      </p>
      <Example page={E} id="leads" />

      <Route id="apagar" method="DELETE" path="/v1/contacts/{contact}?bot_id=" />
      <p>
        Para o pedido do titular (LGPD) que você já confirmou: apaga as conversas, os arquivos, os leads e a ficha do contato, põe o número na lista de supressão e emite o webhook <code>contact.deleted</code>. Responde 202 com o <code>request_id</code> na hora; a exclusão roda logo depois e aparece em Segurança, no painel.
      </p>
      <Example page={E} id="apagar" />
      <Note title="Não tem volta">Depois da exclusão, mandar modelo para esse número volta 422 <code>contact_suppressed</code>, e nada do contato pode ser recuperado.</Note>

      <NextSteps
        items={[
          { href: "/docs/api/campanhas", title: "Campanhas e aceite", text: "Registre o aceite de novidades e mande campanhas." },
          { href: "/docs/seguranca", title: "Segurança", text: "LGPD, segredos e autorização pelo contato." },
        ]}
      />
    </DocPage>
  );
}
