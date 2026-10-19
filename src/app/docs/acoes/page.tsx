import Link from "next/link";
import { Code, DocPage, H2, H3, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Ações" };

const BODY = `
{
  "call_id": "call_3f1c9a0b…",
  "action": "consultar_pedido",
  "params": { "pedido": "1234" },
  "confirmed": false,
  "bot": { "id": "bot_8c1e…" },
  "conversation": { "id": "conv_14a2…", "channel": "whatsapp" },
  "contact": {
    "id": "ctc_77d0…",
    "level": "canal",
    "verified_by": "meta",
    "phone": "5511999990000",
    "whatsapp_user_id": null,
    "age_confirmed": true,
    "age_confirmed_source": "chat"
  },
  "context": null
}
`;

const RESPONSE = `
{
  "data": { "pedido": "1234", "status": "saiu para entrega", "previsao": "20h" },
  "internal": { "cliente_inadimplente": false },
  "components": {
    "type": "buttons",
    "buttons": [{ "title": "Falar com a loja", "id": "falar_loja" }]
  },
  "attachments": [{ "url": "https://seu-sistema.com/notas/1234.pdf", "filename": "nota-1234.pdf" }]
}
`;

const PREVIEW = `
{
  "confirmation": {
    "summary": "Pedido para entrega na Rua das Flores, 10",
    "items": [{ "name": "Pizza Calabresa", "quantity": 2 }, "Coca-Cola 2L"],
    "total_cents": 11180
  }
}
`;

const SIGNATURE = `
// Node: npm i standardwebhooks
import { Webhook } from "standardwebhooks";
const wh = new Webhook(process.env.BOAVOZ_ACTION_SECRET); // whsec_...

// corpo cru (string ou Buffer) e os cabeçalhos da requisição
const chamada = wh.verify(corpoCru, cabecalhos); // lança erro se a assinatura não bate ou passou de 5 minutos
`;

/** Referência das ações (spec Peça 1 e "Formatos de payload", seção 2). */
export default function ActionsDocs() {
  return (
    <DocPage
      title="Ações"
      intro="Uma ação é um endpoint seu que a IA chama durante a conversa. Ela consulta (status do pedido, agenda, saldo) ou faz algo de verdade (criar pedido, agendar, cancelar), sempre com o Confirmar do contato antes."
    >
      <H2 id="tipos">Consulta e executa</H2>
      <Table
        head={["Tipo", "Quando a IA chama", "Prazo"]}
        rows={[
          [<strong key="q">consulta</strong>, "Na hora, quando a pergunta combina com a descrição da ação. Só lê: nada muda no seu sistema.", "8 s"],
          [<strong key="e">executa</strong>, "Só depois que o contato toca em Confirmar num resumo que o BoaVoz monta. Cria, altera ou cancela.", "20 s"],
        ]}
      />
      <p>
        O BoaVoz também classifica as ações: a que cria pedido, reserva ou cobrança sempre pede o Confirmar, mesmo cadastrada como consulta. A IA nunca decide sozinha uma operação dessas: quem decide é o toque do contato.
      </p>

      <H2 id="cadastro">Cadastro</H2>
      <p>
        No painel: chatbot → aba <strong>Ações</strong> (dono ou administrador da agência, com a verificação em duas etapas). O segredo de ações do chatbot precisa existir antes (botão <strong>Gerar segredo</strong>).
      </p>
      <Table
        head={["Campo", "Regras"]}
        rows={[
          ["Nome", <>snake_case, até 48 caracteres, começando por letra. Os nomes das ferramentas do BoaVoz e o prefixo <code key="p">boavoz_</code> são reservados.</>],
          ["Descrição", "De 20 a 500 caracteres. É o que a IA lê para decidir quando chamar: diga o que a ação faz e quando usar."],
          ["URL", "HTTPS, num endereço público (rede interna e localhost são recusados). Sem redirecionamento: cadastre a URL final."],
          ["Parâmetros", <>JSON Schema com <code key="o">{`"type": "object"`}</code>: até 10 parâmetros em snake_case, dos tipos string, number, integer, boolean ou array de um desses; <code key="e">enum</code>, <code key="d">description</code> (até 200) e <code key="r">required</code>.</>],
          ["Tipo", "consulta ou executa."],
          ["Nível mínimo do contato", "anônimo, canal ou usuário (veja Nível do contato)."],
          ["Contexto", "não exige, ou exige contexto assinado (a ação só aparece para a IA em conversas com ele)."],
          ["Cabeçalhos personalizados", <>Opcional, até 10, um por linha (<code key="h">Nome: valor</code>), por exemplo a chave que o seu gateway pede. Vão em toda chamada, guardados cifrados, e não aparecem de novo nem nos logs. Os de assinatura (<code key="w">webhook-*</code>), de transporte e o Content-Type são reservados.</>],
          ["Aceita prévia", <>Só para executa: marque se o endpoint, ao receber <code key="m">{`"mode": "preview"`}</code>, não cria nada e devolve o resumo (veja o Confirmar).</>],
          ["Só no roteiro", "Marcada, a IA só usa a ação no passo de um roteiro ligado (desligar o roteiro tira a ação junto). Desmarcada, a IA usa a ação sempre que a conversa precisar."],
        ]}
      />
      <Note>
        As definições das ações ativas vão junto em cada resposta da IA. Descrições curtas e poucos parâmetros deixam o assistente mais rápido e mais barato; o painel mostra quanto as ações do chatbot pesam.
      </Note>

      <H2 id="chamada">A chamada</H2>
      <p>
        O BoaVoz faz um <code>POST</code> com JSON. Cabeçalhos: <code>content-type: application/json</code>, <code>user-agent: BoaVoz-Acoes/1</code>, os três da assinatura e os seus personalizados.
      </p>
      <Code lang="json · corpo" code={BODY} />
      <Table
        head={["Campo", "O que é"]}
        rows={[
          [<code key="1">call_id</code>, "Id da chamada. Repete quando a mesma chamada é feita de novo (veja Repetição): use para não fazer a mesma operação duas vezes."],
          [<code key="2">action</code>, "O nome da ação."],
          [<code key="3">params</code>, "Os parâmetros que a IA preencheu, já conferidos contra o seu schema (obrigatório vazio, tipo errado ou fora do enum: o BoaVoz nem chama, e a IA pede o dado à pessoa)."],
          [<code key="4">confirmed</code>, <>true quando o contato tocou em Confirmar (ou num botão com ação que vale como confirmação).</>],
          [<code key="5">mode</code>, <><code>{`"preview"`}</code> na prévia do Confirmar. Ausente nas chamadas normais.</>],
          [<code key="6">test</code>, "true quando a chamada vem do botão Testar do painel (sem conversa nem contato)."],
          [<code key="7">bot</code>, <>O chatbot (<code>bot_…</code>).</>],
          [<code key="8">conversation</code>, <>Id (<code>conv_…</code>) e canal: <code>whatsapp</code>, <code>instagram</code> ou <code>widget</code> (o chat do site).</>],
          [<code key="9">contact</code>, "Quem está falando (veja Nível do contato)."],
          [<code key="10">context</code>, <>O contexto da conversa (por exemplo, a loja, o workspace ou a conta), <code>{`{source, data}`}</code>, ou null. <code key="s">source</code>: <code>token</code> (o site), <code>pairing</code> (o pareamento) ou <code>routine</code> (a conta que a identificação pelo roteiro escolheu). Vai só para as ações: a IA não vê.</>],
        ]}
      />

      <H2 id="assinatura">Assinatura</H2>
      <p>
        Toda chamada vai assinada no padrão{" "}
        <a href="https://www.standardwebhooks.com/" target="_blank" rel="noopener noreferrer">
          Standard Webhooks
        </a>{" "}
        com o segredo de ações do chatbot: cabeçalhos <code>webhook-id</code> (o call_id), <code>webhook-timestamp</code> e <code>webhook-signature</code>. Confira com a biblioteca oficial (há para Node, Python, Go, PHP, Ruby, Java e outras) e recuse o que falhar ou tiver mais de 5 minutos.
      </p>
      <Code lang="javascript · node" code={SIGNATURE} />
      <p>
        <strong>Troca do segredo:</strong> ao gerar um novo, o anterior continua valendo por 24 horas, e as chamadas vão com as duas assinaturas nesse período. Se o segredo vazou, marque <strong>invalidar o anterior agora</strong>.
      </p>

      <H2 id="prazos">Prazos, tamanho e repetição</H2>
      <ul>
        <li>Consulta: 8 segundos. Executa: 20 segundos. Passou disso, a consulta conta como falha e a executa fica <strong>incerta</strong> (veja o Confirmar).</li>
        <li>Resposta de até 32 KB. Acima de 8 KB no <code>data</code>, o painel avisa: tudo isso vai para a IA em cada resposta.</li>
        <li>Redirecionamento (3xx) não é seguido: dá erro com o endereço para você cadastrar.</li>
        <li>
          <strong>Repetição:</strong> numa consulta, o <code>call_id</code> sai da mensagem do contato, da ação e dos parâmetros; se o BoaVoz processar a mesma mensagem de novo, a chamada vai com o mesmo id e, se a anterior deu certo, a resposta gravada é reaproveitada sem chamar você. Numa executa, o <code>call_id</code> é o do Confirmar e se repete em todo “Tentar de novo”. O BoaVoz nunca refaz uma executa sozinho.
        </li>
      </ul>
      <Note title="Seja idempotente nas executa">
        Mesmo <code>call_id</code> = mesma operação. Se receber de novo um id que você já processou, devolva o mesmo resultado sem criar outro pedido.
      </Note>

      <H2 id="resposta">A resposta</H2>
      <Table
        head={["HTTP", "Para o BoaVoz"]}
        rows={[
          ["2xx com JSON", "Deu certo: lê os campos abaixo."],
          ["404", <>Não encontrado. Mande <code key="e">{`{"error": "motivo"}`}</code>: a IA diz que não achou, sem inventar. Use também para o que a pessoa não pode ver.</>],
          ["409", <>Numa executa: ainda está processando. A chamada fica incerta.</>],
          ["2xx sem corpo", <>Numa executa confirmada: sucesso. Numa consulta: falha (resposta vazia).</>],
          ["Outro", "Falha: a IA diz que não conseguiu agora, sem inventar o resultado (numa executa, oferece tentar de novo daqui a pouco ou falar com a equipe)."],
        ]}
      />
      <Code lang="json · resposta" code={RESPONSE} />
      <Table
        head={["Campo", "O que acontece"]}
        rows={[
          [<code key="d">data</code>, "Os dados para a IA responder com as palavras dela. Qualquer JSON."],
          [<code key="r">reply</code>, "Texto exato para o contato (até 4.000 caracteres). Com reply, a IA não escreve nada naquela vez: vai o seu texto, com os botões e os arquivos da mesma resposta."],
          [<code key="i">internal</code>, <>Objeto que a IA usa para decidir o que dizer, mas que nunca aparece: frase da resposta que contiver um desses valores sai, e se não sobrar nada o contato recebe <em>“Não consigo te passar essa informação por aqui. Posso ajudar com outra coisa?”</em>.</>],
          [<code key="c">components</code>, <>Botões, lista, link ou carrossel (veja <Link href="/docs/mensagens-ricas">Mensagens ricas</Link>). Numa consulta sem reply, eles só vão se a resposta da IA oferece essa escolha; com reply e no resultado do Confirmar, vão sempre.</>],
          [<code key="a">attachments</code>, <>Até 5 arquivos <code>{`{url, filename?}`}</code>, em HTTPS (veja Arquivos).</>],
          [<code key="p">confirmation</code>, "Só na prévia do Confirmar (veja abaixo)."],
          [<code key="o">outcome</code>, <>Num passo de ação de um roteiro: o resultado que escolhe o próximo passo (<code key="ex">{`"sem_debito"`}</code>), entre os declarados no cadastro (veja <Link href="/docs/roteiros#acao">Roteiros</Link>).</>],
          [<code key="id">identity</code>, <>Num passo de ação de um roteiro: quem é a pessoa (<code key="f">{`{external_id, name, accounts}`}</code>). A conversa fica identificada e as próximas ações recebem o nível usuário (veja <Link href="/docs/roteiros#identificar">Identificar a pessoa</Link>).</>],
        ]}
      />

      <H3 id="arquivos">Arquivos</H3>
      <p>
        O BoaVoz baixa cada arquivo (até 25 MB), confere o tipo pelo conteúdo e recusa executável, HTML e SVG. Imagem que o canal aceita vai como imagem; PDF e os documentos aceitos pelo canal vão como documento; o resto vai como link que vale 7 dias. Os arquivos saem logo depois do texto. Se um falhar, o contato recebe “Não consegui anexar o arquivo agora.”.
      </p>

      <H2 id="confirmar">Ações que criam ou alteram: o Confirmar</H2>
      <ol>
        <li>A IA chama a ação com todos os parâmetros obrigatórios. O seu endpoint ainda não é chamado.</li>
        <li>
          O BoaVoz manda ao contato um resumo fixo, sem texto da IA: “Confere antes de eu concluir:”, as linhas do pedido e “Nada é feito antes do Confirmar.”, com os botões <strong>Confirmar</strong> e <strong>Cancelar</strong>.
        </li>
        <li>
          No Confirmar, o BoaVoz chama o seu endpoint com <code>{`"confirmed": true`}</code>. A IA conta o resultado a partir do <code>data</code> (citando o número do pedido ou o protocolo que você devolver), ou vai o seu <code>reply</code>.
        </li>
      </ol>
      <H3 id="previa">O resumo e a prévia</H3>
      <p>
        Sem prévia, o resumo lista os parâmetros (com os nomes dos itens que uma consulta anterior trouxe, em vez dos ids). Com <strong>aceita prévia</strong>, antes do resumo o BoaVoz chama o seu endpoint com <code>{`"mode": "preview"`}</code>: não crie nada e devolva o resumo calculado pelo seu sistema (preço atual, taxa, total).
      </p>
      <Code lang="json · resposta da prévia" code={PREVIEW} />
      <H3 id="regras-confirmar">Regras</H3>
      <ul>
        <li>Os botões valem por 24 horas e uma vez só. Tocar de novo responde “Esse pedido já foi confirmado.”.</li>
        <li>Um resumo novo da mesma ação na mesma conversa substitui o anterior.</li>
        <li>“sim”, “confirmo” ou “1”, escritos sozinhos logo depois do resumo, valem como Confirmar; “não”, “cancelar” ou “2”, como Cancelar.</li>
        <li>
          <strong>Incerta</strong> (passou de 20 s ou 409): o contato recebe “Não consegui confirmar se deu certo” com <strong>Tentar de novo</strong> (mesmo <code>call_id</code>, sem duplicar) e <strong>Falar com alguém</strong>.
        </li>
        <li>Um botão com ação (em Mensagens ricas) também vale como confirmação: o toque chama a ação direto, com os parâmetros guardados no BoaVoz.</li>
      </ul>

      <H2 id="nivel">Nível do contato</H2>
      <p>A ação só aparece para a IA quando o contato alcança o nível mínimo dela.</p>
      <Table
        head={["Nível", "Quem é", "No contact"]}
        rows={[
          [<strong key="a">anônimo</strong>, "Qualquer contato, inclusive o visitante do site.", <>verified_by null; phone null.</>],
          [<strong key="c">canal</strong>, "O canal garante quem é: o número no WhatsApp, a conta no Instagram.", <>verified_by <code>meta</code>; no WhatsApp, <code>phone</code> só com dígitos e o código do país (no Instagram, null).</>],
          [<strong key="u">usuário</strong>, "A empresa identificou a pessoa (token assinado no site, pareamento no WhatsApp ou no Instagram, ou a sua ação num roteiro).", <>verified_by <code>signed_token</code>, <code>pairing</code> ou <code>routine</code>; <code>external_id</code> (o id dela no seu sistema) e <code>display</code>.</>],
        ]}
      />
      <p>
        <code>age_confirmed</code> diz se a pessoa confirmou ter 18 anos (<code>age_confirmed_source</code>: <code>chat</code> ou <code>company</code>). Para dados pessoais, autorize sempre pelo contato verificado, nunca só pelo que a pessoa digitou: pedido de outra pessoa responde 404, como se não existisse.
      </p>

      <H2 id="portao">WhatsApp e Instagram: o portão</H2>
      <p>Nesses canais, o BoaVoz confere o que a ação devolve pelas regras da Meta antes de qualquer coisa chegar ao contato:</p>
      <ul>
        <li>No <code>data</code>, itens proibidos saem, e bebida alcoólica e remédio ficam de fora até a pessoa confirmar 18 anos. Depois do “Sim”, a mesma consulta é chamada de novo.</li>
        <li>O <code>reply</code> nunca é editado: com item 18+ sem confirmação, ele espera o “Sim”; com item proibido, é descartado e a IA responde com o <code>data</code> já filtrado.</li>
        <li>Botões, cards e arquivos são conferidos um a um.</li>
        <li>A venda de bebida alcoólica e de remédio nunca fecha no chat: o pedido desses itens vai para o site, o app ou o telefone que o chatbot tiver.</li>
      </ul>

      <H2 id="limites">Limites</H2>
      <ul>
        <li>15 chamadas de ação por minuto em cada conversa e 600 por minuto em cada chatbot.</li>
        <li>5 respostas “não encontrado” da mesma ação na mesma conversa em 1 hora: a ação fica indisponível nessa conversa por um tempo (ninguém varre números de pedido).</li>
      </ul>

      <NextSteps
        items={[
          { href: "/docs/mensagens-ricas", title: "Mensagens ricas", text: "Botões, lista, link e carrossel no retorno da ação." },
          { href: "/docs/comeco-rapido", title: "Começo rápido", text: "O exemplo completo de consultar pedido." },
        ]}
      />
    </DocPage>
  );
}
