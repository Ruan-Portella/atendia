import Link from "next/link";
import { Code, DocPage, H2, H3, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Identificar usuários" };

const SIGN_NODE = `
// npm i jsonwebtoken — no SEU servidor, depois do login (nunca no navegador)
import jwt from "jsonwebtoken";

app.get("/api/chat-token", exigeLogin, (req, res) => {
  const token = jwt.sign(
    {
      external_id: req.user.id,                       // o id dela no seu sistema
      user_display: { name: req.user.primeiroNome },  // o que a IA pode chamar
      context: { workspace_id: req.workspace.id },     // a conta ativa (vai só para as ações)
      context_display: req.workspace.nome,             // como a conta aparece na conversa
    },
    process.env.BOAVOZ_IDENTITY_SECRET,
    { algorithm: "HS256", keyid: process.env.BOAVOZ_IDENTITY_KID, audience: "CHAVE_DO_WIDGET", expiresIn: "1h" },
  );
  res.type("text/plain").send(token);
});
`;

const SIGN_PY = `
# pip install PyJWT — no SEU servidor, depois do login
import os, time, jwt

def chat_token(usuario, workspace):
    agora = int(time.time())
    return jwt.encode(
        {
            "aud": "CHAVE_DO_WIDGET",
            "iat": agora,
            "exp": agora + 3600,
            "external_id": usuario.id,
            "user_display": {"name": usuario.primeiro_nome},
            "context": {"workspace_id": workspace.id},
            "context_display": workspace.nome,
        },
        os.environ["BOAVOZ_IDENTITY_SECRET"],
        algorithm="HS256",
        headers={"kid": os.environ["BOAVOZ_IDENTITY_KID"]},
    )
`;

const WIDGET = `
<script>
  window.ChatWidgetConfig = {
    // chamado ao abrir o chat e 5 minutos antes de o token vencer
    getToken: async () => (await fetch("/api/chat-token")).text(),
  };
</script>
<script src="https://SEU-DOMINIO/widget.js" data-key="CHAVE_DO_WIDGET" async></script>

<script>
  // a pessoa entrou depois de a página carregar o widget
  ChatWidget.identify(() => fetch("/api/chat-token").then((r) => r.text()));
  // trocou de conta: abre uma conversa nova, no contexto novo
  ChatWidget.setContext(novoToken);
  // saiu: limpa a tela (a conversa já é protegida pelo token)
  ChatWidget.logout();
</script>
`;

/** Identificar usuários (spec Peça 4 e "Formatos de payload", seção 5). */
export default function IdentityDocs() {
  return (
    <DocPage
      title="Identificar usuários"
      intro="Quando a empresa diz ao BoaVoz quem é a pessoa, as ações dela recebem o contato no nível usuário, com o id da pessoa no seu sistema e a conta ativa. É o que libera saldo, segunda via e dados da conta na conversa."
    >
      <H2 id="dois-caminhos">Dois caminhos</H2>
      <Table
        head={["Onde", "Como", "Quando usar"]}
        rows={[
          ["Chat do site", "Token assinado pelo seu servidor, entregue ao widget.", "A pessoa já está logada no seu site."],
          ["WhatsApp e Instagram", "Pareamento: seu sistema gera um código, a pessoa manda “Conectar ABC123” para o chatbot.", "Ligar o número (ou a conta do Instagram) à conta dela, uma vez."],
        ]}
      />
      <p>
        Nos dois, a IA vê só o nome de exibição e nunca pede documento ou senha: a identidade já foi confirmada pela empresa. As ações recebem <code>contact.level = &quot;usuario&quot;</code>, o <code>external_id</code> e o <code>context</code>.
      </p>

      <H2 id="token">Token no chat do site</H2>
      <H3 id="segredo">O segredo de identidade</H3>
      <p>
        O token é um JWT assinado com HS256 com o segredo de identidade da agência, que tem um id (<code>kid</code>) e vale para um chatbot, para os chatbots de um cliente ou para todos. Por enquanto, quem gera esse segredo é a equipe do BoaVoz: peça pelo suporte. A tela para gerar e revogar no painel vem a seguir.
      </p>
      <H3 id="campos">O que vai no token</H3>
      <Table
        head={["Campo", "Regra"]}
        rows={[
          [<code key="k">kid</code>, "No cabeçalho do JWT: o id do segredo. alg sempre HS256 (outro algoritmo é recusado)."],
          [<code key="a">aud</code>, "A chave do widget (o data-key do script)."],
          [<><code key="i">iat</code> e <code key="e">exp</code></>, "Em segundos. exp no máximo 1 hora e 1 minuto à frente (folga de 60 s no relógio)."],
          [<code key="x">external_id</code>, "O id da pessoa no seu sistema (até 128 caracteres). Sem ele, o token só define o contexto e a pessoa segue anônima."],
          [<code key="u">user_display</code>, <>O que a IA pode usar para tratar a pessoa, por exemplo <code>{`{"name": "Ruan"}`}</code> (até 512 bytes).</>],
          [<code key="c">context</code>, "A conta ativa (workspace, loja), em JSON de até 2 KB. Vai só para as ações."],
          [<code key="cd">context_display</code>, "Como a conta aparece na conversa (até 120 caracteres)."],
          [<code key="ag">age_verified</code>, "Opcional: true se o seu cadastro já conferiu que a pessoa tem 18 anos."],
        ]}
      />
      <Code lang="javascript · node" code={SIGN_NODE} />
      <Code lang="python" code={SIGN_PY} />
      <H3 id="widget">No site</H3>
      <Code lang="html" code={WIDGET} />
      <ul>
        <li>O token vai só para o iframe do chat e é conferido em toda requisição.</li>
        <li>A conversa de uma pessoa fica presa a ela e ao contexto: outra pessoa no mesmo navegador, sem sair, não vê nada da primeira.</li>
        <li>Uma conversa anônima vira da pessoa uma vez, quando ela entra; depois, nunca troca de dono nem de contexto.</li>
      </ul>

      <H2 id="pareamento">Pareamento no WhatsApp e no Instagram</H2>
      <ol>
        <li>
          Seu sistema chama <code>POST /v1/pairings</code> com <code>external_id</code>, <code>context</code> e <code>display</code> (veja a <Link href="/docs/api#pareamento">referência</Link>) e recebe o código e o link.
        </li>
        <li>A pessoa abre o link no celular: o WhatsApp abre com “Conectar ABC123” escrito (no Instagram, o link leva o código, ou ela digita o código na DM). Ela manda e confirma.</li>
        <li>O BoaVoz liga o contato à conta dela e emite o webhook <code>contact.linked</code>. Daí em diante, as ações recebem o nível usuário nesse canal.</li>
      </ol>
      <ul>
        <li>O código tem 6 caracteres, vale 10 minutos e uma vez só.</li>
        <li>Com <code>expected_phone</code> (WhatsApp), código mandado de outro número é recusado.</li>
        <li>Mais de 5 códigos errados de um contato em 1 hora bloqueiam novas tentativas por um tempo.</li>
        <li>Se o número já estava ligado a outra conta, o BoaVoz pede confirmação antes de trocar.</li>
        <li>A pessoa pode ter várias contas ligadas; uma fica ativa. Se ela pedir para trocar, a IA troca, e a conversa abre um trecho novo (a IA só lê o que veio depois).</li>
        <li>“desconectar” no chat desfaz o vínculo ativo (webhook <code>contact.unlinked</code>). Pela API: <code>DELETE /v1/contacts/{"{contact}"}/links/{"{id}"}</code>.</li>
      </ul>
      <Note title="O que a IA vê e o que as ações recebem">
        A IA vê o nome de exibição e o nome da conta ativa, para tratar a pessoa e citar a conta nas respostas. O <code>external_id</code> e o <code>context</code> vão só para as suas ações.
      </Note>

      <NextSteps
        items={[
          { href: "/docs/seguranca", title: "Segurança", text: "Autorizar pelo external_id e pelo contexto, nunca pelo que foi digitado." },
          { href: "/docs/exemplos", title: "Exemplos", text: "Faturamento por workspace, com contexto, em Node e Python." },
        ]}
      />
    </DocPage>
  );
}
