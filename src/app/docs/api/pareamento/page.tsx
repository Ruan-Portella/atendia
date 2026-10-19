import Link from "next/link";
import { Access, DocPage, Example, NextSteps, Route, Table } from "@/components/docs/doc";

export const metadata = { title: "Pareamento · API" };

const E = "pareamento";

/** /docs/api/pareamento: o código de pareamento e os vínculos (código em src/lib/api-pairing.ts). */
export default function PairingApiDocs() {
  return (
    <DocPage eyebrow="Documentação · API" title="Pareamento" intro="Ligue o contato do WhatsApp ou do Instagram à conta dele no seu sistema: você gera um código, a pessoa manda o código para o chatbot e confirma. Depois disso, as ações recebem o id dela no seu sistema.">
      <Access permission="pairing" />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#codigo"><code>POST /v1/pairings</code></Link>, "Gera o código (6 caracteres, uso único, 10 minutos) e o link que a pessoa abre."],
          [<Link key="2" href="#vinculos"><code>GET /v1/contacts/{"{contact}"}/links</code></Link>, "Os vínculos ativos do contato."],
          [<Link key="3" href="#desvincular"><code>DELETE /v1/contacts/{"{contact}"}/links/{"{id}"}</code></Link>, "Desfaz um vínculo."],
        ]}
      />
      <p>
        O caminho completo, com o que a pessoa vê no chat e o que as ações recebem, está em <Link href="/docs/identificar-usuarios">Identificar usuários</Link>.
      </p>

      <Route id="codigo" method="POST" path="/v1/pairings" />
      <p>
        O pareamento só termina quando a pessoa abre o link no celular (ele abre o chat do chatbot com “Conectar &lt;código&gt;” escrito) e manda a mensagem; se o contato já estava ligado a outra conta, ele confirma antes. Sai o webhook <code>contact.linked</code>.
      </p>
      <Example page={E} id="codigo" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">bot_id</code>, "Obrigatório; o chatbot precisa ter o canal conectado.", <><code>403 forbidden_scope</code>; 422 <code>channel_not_connected</code></>],
          [<code key="2">channel</code>, <><code>whatsapp</code> ou <code>instagram</code>.</>, <>400 <code>channel</code></>],
          [<code key="3">external_id</code>, "Obrigatório: o id da pessoa no seu sistema (até 128 caracteres). Volta para as ações e na API como ext:.", <>400 <code>external_id</code></>],
          [<code key="4">context</code>, "Opcional: um objeto seu (até 2 KB), entregue às ações junto do external_id. A IA não vê.", <>400 <code>context</code></>],
          [<code key="5">display</code>, <>Opcional: <code>{"{name, workspace_name}"}</code> (até 80 caracteres cada), o que a IA pode usar na conversa.</>, <>400 <code>display…</code></>],
          [<code key="6">expected_phone</code>, "Opcional, só no WhatsApp: o número que você espera (com DDD). Outro número tentando o código não pareia.", <>400 <code>expected_phone</code></>],
        ]}
      />

      <Route id="vinculos" method="GET" path="/v1/contacts/{contact}/links" />
      <p>
        <code>source</code> diz de onde veio o vínculo: <code>pairing</code> (pelo código) ou <code>routine</code> (o número lembrado pelo roteiro, com a licença da pessoa). Com <code>ext:</code> sem vínculo ativo, a lista vem vazia.
      </p>
      <Example page={E} id="vinculos" />

      <Route id="desvincular" method="DELETE" path="/v1/contacts/{contact}/links/{id}" />
      <p>
        Responde 204. Sai o webhook <code>contact.unlinked</code>. Id que não é <code>lnk_…</code>: 400 <code>id</code>.
      </p>
      <Example page={E} id="desvincular" />

      <NextSteps
        items={[
          { href: "/docs/identificar-usuarios", title: "Identificar usuários", text: "O pareamento passo a passo e o token do widget." },
          { href: "/docs/acoes", title: "Ações", text: "O que as ações recebem do contato identificado." },
        ]}
      />
    </DocPage>
  );
}
