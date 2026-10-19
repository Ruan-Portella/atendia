import Link from "next/link";
import { Code, DocPage, H2, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Primeira ação" };

const ENDPOINT = `
// npm i express standardwebhooks
import express from "express";
import { Webhook } from "standardwebhooks";

const app = express();
// o segredo de ações que o painel mostrou (whsec_...)
const wh = new Webhook(process.env.BOAVOZ_ACTION_SECRET);

// exemplo: os pedidos do seu sistema
const pedidos = {
  "1234": { status: "saiu para entrega", previsao: "hoje, até as 20h", telefone: "5511999990000" },
};

// o corpo cru: a assinatura é conferida sobre ele
app.post("/boavoz/consultar-pedido", express.text({ type: "*/*" }), (req, res) => {
  let chamada;
  try {
    // confere a assinatura e o horário (até 5 minutos) e devolve o JSON
    chamada = wh.verify(req.body, req.headers);
  } catch {
    return res.status(401).json({ error: "assinatura inválida" });
  }

  // botão Testar do painel: sem conversa nem contato
  if (chamada.test) return res.json({ data: { pedido: "TESTE", status: "teste ok" } });

  const pedido = pedidos[String(chamada.params.pedido)];
  // só o dono do pedido: o telefone que o WhatsApp garante
  if (!pedido || pedido.telefone !== chamada.contact?.phone) {
    return res.status(404).json({ error: "pedido não encontrado" });
  }
  res.json({ data: { pedido: chamada.params.pedido, status: pedido.status, previsao: pedido.previsao } });
});

app.listen(3000);
`;

const SCHEMA = `
{
  "type": "object",
  "properties": {
    "pedido": { "type": "string", "description": "número do pedido" }
  },
  "required": ["pedido"]
}
`;

const BODY = `
{
  "call_id": "call_3f1c9a…",
  "action": "consultar_pedido",
  "params": { "pedido": "1234" },
  "confirmed": false,
  "bot": { "id": "bot_…" },
  "conversation": { "id": "conv_…", "channel": "whatsapp" },
  "contact": {
    "id": "ctc_…",
    "level": "canal",
    "verified_by": "meta",
    "phone": "5511999990000",
    "whatsapp_user_id": null,
    "age_confirmed": null,
    "age_confirmed_source": null
  },
  "context": null
}
`;

/** Primeira ação funcionando em 5 minutos (spec: exemplo "consultar pedido"). */
export default function QuickStart() {
  return (
    <DocPage
      title="Primeira ação"
      intro="Em 5 minutos: o contato pergunta “cadê meu pedido 1234?” no WhatsApp e o assistente responde com o status que vem do seu sistema."
    >
      <H2 id="segredo">1. Gere o segredo de ações</H2>
      <p>
        No painel, abra o chatbot, vá na aba <strong>Ações</strong> e toque em <strong>Gerar segredo</strong>. Ele começa com <code>whsec_</code> e aparece uma vez só: guarde no seu servidor (aqui, na variável <code>BOAVOZ_ACTION_SECRET</code>). Toda chamada do BoaVoz vai assinada com ele.
      </p>

      <H2 id="endpoint">2. Suba o endpoint</H2>
      <p>
        Um <code>POST</code> em HTTPS que recebe JSON e devolve JSON. A assinatura segue o padrão{" "}
        <a href="https://www.standardwebhooks.com/" target="_blank" rel="noopener noreferrer">
          Standard Webhooks
        </a>
        , então a biblioteca oficial confere tudo numa linha.
      </p>
      <Code lang="javascript · node" code={ENDPOINT} />
      <Note title="Autorize pelo contato verificado">
        O número do pedido vem da conversa, e qualquer um pode digitar um número. Responda só se o pedido for de quem está falando: no WhatsApp, <code>contact.phone</code> é o número garantido pela Meta (só dígitos, com o 55). Pedido de outra pessoa responde igual a pedido que não existe (404).
      </Note>

      <H2 id="cadastro">3. Cadastre a ação</H2>
      <p>
        Na aba <strong>Ações</strong> do chatbot, crie a ação:
      </p>
      <Table
        head={["Campo", "Valor"]}
        rows={[
          ["Nome", <code key="n">consultar_pedido</code>],
          ["URL", <code key="u">https://seu-sistema.com/boavoz/consultar-pedido</code>],
          ["Descrição", "Consulta o status e a previsão de entrega de um pedido pelo número. Use quando a pessoa perguntar do pedido dela."],
          ["Parâmetros", "o JSON Schema abaixo"],
          ["Tipo", "consulta"],
          ["Nível mínimo do contato", "canal (a ação só aparece para a IA quando o canal garante quem é o contato)"],
          ["Contexto", "não exige"],
        ]}
      />
      <Code lang="json · parâmetros" code={SCHEMA} />
      <p>
        A descrição é o que a IA lê para decidir quando chamar: diga o que a ação faz e quando usar. A descrição dos parâmetros ajuda a IA a pedir o dado certo (“qual o número do pedido?”) quando a pessoa não disse.
      </p>

      <H2 id="testar">4. Teste</H2>
      <p>
        Na ação cadastrada, use <strong>Testar</strong> com <code>{`{"pedido": "1234"}`}</code>. O BoaVoz chama o seu endpoint de verdade, com <code>{`"test": true`}</code> e sem conversa nem contato, e mostra a resposta.
      </p>

      <H2 id="conversa">5. Converse</H2>
      <p>
        No WhatsApp conectado ao chatbot, mande “cadê meu pedido 1234?”. A IA chama a ação e responde com o status e a previsão. Sem o número, ela pergunta qual é. Com um pedido de outra pessoa, diz que não encontrou.
      </p>
      <p>É isto que o seu endpoint recebeu:</p>
      <Code lang="json · corpo da chamada" code={BODY} />
      <p>
        O detalhe de cada campo, os prazos, o que você pode devolver (texto exato, botões, arquivos) e as ações que criam ou alteram algo, com o Confirmar do contato, estão em <Link href="/docs/acoes">Ações</Link>.
      </p>

      <NextSteps
        items={[
          { href: "/docs/acoes", title: "Ações", text: "Referência completa: chamada, resposta, assinatura, prazos e Confirmar." },
          { href: "/docs/mensagens-ricas", title: "Mensagens ricas", text: "Devolva botões, lista ou carrossel junto da resposta." },
        ]}
      />
    </DocPage>
  );
}
