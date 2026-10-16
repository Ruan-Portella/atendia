import Link from "next/link";
import { Code, DocPage, H2, Note, NextSteps } from "@/components/docs/doc";

export const metadata = { title: "Segurança" };

const WRONG = `
// ERRADO: qualquer um que digitar o número vê o pedido de outra pessoa
const pedido = await db.pedidos.find(chamada.params.pedido);
if (!pedido) return res.status(404).json({ error: "pedido não encontrado" });
return res.json({ data: pedido });

// ERRADO: CPF, nome ou e-mail vieram do que a pessoa digitou (a IA só repassa)
const cliente = await db.clientes.findByCpf(chamada.params.cpf);
`;

const RIGHT = `
// CERTO (ação com nível mínimo "canal"): o pedido precisa ser do telefone que o WhatsApp garante
const pedido = await db.pedidos.find(chamada.params.pedido);
if (!pedido || pedido.telefone !== chamada.contact?.phone) {
  // não existe e "é de outra pessoa" respondem igual
  return res.status(404).json({ error: "pedido não encontrado" });
}

// CERTO (ação com nível mínimo "usuário"): a conta vem do vínculo assinado, não do que foi digitado
const conta = await db.contas.find(chamada.contact.external_id);
const fatura = await db.faturas.ultimaDa(conta.id, chamada.context?.data?.workspace_id);
`;

/** Segurança (spec: "como autorizar pelo contato verificado", com o exemplo certo e o errado). */
export default function SecurityDocs() {
  return (
    <DocPage
      title="Segurança"
      intro="A IA conversa com qualquer pessoa. O que protege os dados do seu cliente é o seu endpoint decidir pelo contato verificado, nunca pelo que a pessoa digitou."
    >
      <H2 id="contato-verificado">Autorize pelo contato verificado</H2>
      <p>
        Parâmetros (número do pedido, CPF, e-mail) vêm da conversa: a pessoa digita, a IA repassa. Eles servem para achar o registro, nunca para provar quem pediu. Quem prova é o <code>contact</code> da chamada: o telefone que a Meta garante (nível canal) ou o <code>external_id</code> da conta que a sua empresa ligou (nível usuário).
      </p>
      <Code lang="javascript · errado" code={WRONG} />
      <Code lang="javascript · certo" code={RIGHT} />
      <ul>
        <li>Cadastre a ação com o nível mínimo certo: abaixo dele, a IA nem vê a ação.</li>
        <li>Responda 404 igual para “não existe” e “é de outra pessoa”: assim ninguém descobre quais números existem. O BoaVoz ainda tira a ação da conversa depois de 5 respostas “não encontrado” em 1 hora.</li>
        <li>
          Quando a IA precisa saber de algo que não pode contar (cliente inadimplente, limite de crédito), mande em <code>internal</code>: a frase que contiver esses valores não sai.
        </li>
      </ul>

      <H2 id="assinaturas">Confira as assinaturas</H2>
      <p>
        Ações e webhooks chegam assinados no padrão Standard Webhooks. Confira a assinatura e o horário (até 5 minutos) com a biblioteca oficial antes de qualquer coisa, e recuse o que falhar com 401. Use o <code>webhook-id</code> (o <code>call_id</code> na ação, o id do evento no webhook) para não processar a mesma coisa duas vezes.
      </p>

      <H2 id="segredos">Segredos e chaves</H2>
      <ul>
        <li>O segredo de ações (do chatbot), o segredo de cada webhook e as chaves de API aparecem uma vez só. Guarde no servidor, nunca no código do site ou do app.</li>
        <li>Trocar um segredo mantém o anterior por 24 horas (as duas assinaturas vão juntas); se vazou, marque “invalidar o anterior agora”.</li>
        <li>Chave de API com o escopo e as permissões mínimos para cada integração; revogue a que não usa mais.</li>
        <li>Cabeçalhos personalizados (a chave do seu gateway, por exemplo) ficam cifrados e não aparecem de novo nem nos logs.</li>
      </ul>

      <H2 id="enderecos">Endereços</H2>
      <p>
        O BoaVoz só chama endereços HTTPS públicos (rede interna e localhost são recusados) e não segue redirecionamento. Arquivos devolvidos pelas ações são baixados e conferidos antes de ir ao contato: executável, HTML e SVG não passam.
      </p>

      <H2 id="lgpd">Dados pessoais (LGPD)</H2>
      <ul>
        <li>
          Pedido do titular: quando chegar o webhook <code>contact.deleted</code>, apague o contato do seu lado também. Pela API, o mesmo pedido é o <code>DELETE /v1/contacts/{"{contact}"}</code>.
        </li>
        <li>O link de arquivo nos eventos vale 1 hora; para baixar depois, use a API, que confere o escopo da chave.</li>
        <li>As mensagens, o telefone e o pedido dos leads e os corpos dos webhooks ficam cifrados no BoaVoz com a chave do cliente.</li>
      </ul>
      <Note title="Achou uma falha?">
        Conte para a gente antes de divulgar: veja <Link href="/seguranca">a página de segurança</Link>.
      </Note>

      <NextSteps
        items={[
          { href: "/docs/acoes", title: "Ações", text: "Nível do contato, contexto e o campo internal." },
          { href: "/docs/webhooks", title: "Webhooks", text: "Receber e conferir os eventos." },
        ]}
      />
    </DocPage>
  );
}
