import Link from "next/link";
import { Code, DocPage, H2, H3, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Roteiros" };

const IDENTITY = `
{
  "data": { "cliente": "Ana Souza", "contas": 2 },
  "identity": {
    "external_id": "cli_123",
    "name": "Ana",
    "accounts": [
      { "label": "Rua das Flores, 10", "context": { "uc": "1001" } },
      { "label": "Av. Brasil, 200", "context": { "uc": "1002" } }
    ]
  }
}
`;

const EVENT = `
{
  "id": "evt_q8m2c4…",
  "type": "routine.completed",
  "created_at": "2026-10-19T15:03:12.511Z",
  "bot": { "id": "bot_8c1e…", "name": "Bar do Zé" },
  "client": { "id": "cli_51a0…", "external_id": null },
  "conversation": { "id": "conv_14a2…", "channel": "whatsapp" },
  "contact": { "id": "ctc_77d0…", "whatsapp_user_id": null, "phone": "5511999990000", "instagram_id": null, "display": { "name": "Ana" } },
  "data": {
    "routine": { "id": "rtn_3b9e…", "name": "Segunda via" },
    "run": { "id": "run_7f21…", "started_by": "keyword", "started_at": "2026-10-19T15:01:40.118Z", "ended_at": "2026-10-19T15:03:12.511Z", "step": 2, "steps_total": 3 }
  }
}
`;

/** Roteiros (leva B2'): passos, ação, identificação, foto, fim e eventos. */
export default function RoutinesDocs() {
  return (
    <DocPage
      title="Roteiros"
      intro="Um roteiro é uma sequência de passos que a IA segue quando a conversa entra num assunto: segunda via, troca, suporte técnico. A IA conversa com naturalidade dentro de cada passo; quem decide o caminho é o BoaVoz, pelo dado conferido, pelo botão tocado e pelo resultado da ação."
    >
      <H2 id="inicio">Como um roteiro começa</H2>
      <ul>
        <li>
          Pelo <strong>Quando usar</strong>: a IA reconhece o assunto e começa o roteiro.
        </li>
        <li>
          Pela <strong>palavra-chave</strong>: a mensagem que é só a palavra (sem diferença de maiúsculas e acentos) começa o roteiro na hora, sem passar pela IA.
        </li>
        <li>Um roteiro por conversa. A palavra-chave de outro roteiro, ou a IA começando outro porque a pessoa mudou de assunto, troca o que estava aberto.</li>
      </ul>
      <p>
        No painel: chatbot → aba <strong>Roteiros</strong>, com 5 modelos prontos (orçamento, pedido de agendamento, troca e devolução, segunda via e rastreio). Roteiro sem ação não precisa de desenvolvedor; o passo de ação faz parte do pacote Integrações.
      </p>

      <H2 id="passos">Passos</H2>
      <Table
        head={["Passo", "O que acontece"]}
        rows={[
          [<strong key="i">Instrução</strong>, "A IA diz ou pergunta o que o passo pede e segue quando ele foi cumprido."],
          [
            <strong key="d">Pedir um dado</strong>,
            "CPF, CNPJ, CPF ou CNPJ, e-mail, telefone, CEP, data, número ou formato próprio (regex). O BoaVoz confere (o dígito verificador no CPF e no CNPJ, também o CNPJ alfanumérico) e pede de novo até 3 vezes; depois, oferece os botões “Falar com a equipe” e “Cancelar”. No WhatsApp, o telefone da conversa entra sozinho.",
          ],
          [<strong key="b">Botões</strong>, "De 2 a 10 opções, cada uma com o seu destino. Até 3 viram botões no WhatsApp; de 4 a 10, uma lista. A escolha digitada (o número ou o texto da opção) também vale."],
          [<strong key="a">Ação</strong>, <>Chama uma ação do chatbot; o resultado escolhe o destino (veja Passo de ação).</>],
          [<strong key="f">Pedir uma foto</strong>, <>Só no WhatsApp e no Instagram (veja Pedir uma foto).</>],
        ]}
      />
      <p>Destinos de cada passo, botão ou resultado: o próximo passo, outro passo, encerrar o roteiro ou chamar atendente. A IA nunca pula nem inventa passos.</p>
      <Note title="O que um roteiro nunca pede">Número de cartão, conta bancária, senha ou código de verificação: a política do WhatsApp proíbe, e é o caminho dos golpes. O editor recusa o roteiro que pede.</Note>

      <H2 id="acao">Passo de ação</H2>
      <p>
        Os parâmetros da ação com o mesmo nome de uma variável do roteiro vão preenchidos pelo BoaVoz, com o valor conferido, e a IA nem vê esses parâmetros. O formato é o mesmo em toda ação:
      </p>
      <Table
        head={["Tipo da variável", "Vai para a ação como"]}
        rows={[
          ["CPF, CNPJ, CPF ou CNPJ", <>Só os caracteres, sem pontuação (o CNPJ alfanumérico em maiúsculas): <code key="c">52998224725</code>.</>],
          ["Telefone e CEP", "Só os números."],
          ["E-mail", "Em minúsculas."],
          ["Data", <><code key="d">aaaa-mm-dd</code>.</>],
          ["Número", <>Com ponto decimal; no parâmetro <code key="n">number</code> ou <code key="i">integer</code>, vai como número.</>],
          ["Escolha (botões)", "O texto do botão tocado."],
          ["Foto", "A descrição que a IA leu da foto."],
        ]}
      />
      <p>
        <strong>Resultado → destino:</strong> <code>ok</code> (2xx), <code>nao_encontrado</code> (404) e <code>erro</code> (o resto: falha, demora ou incerta), mais os resultados que a ação declara no cadastro e devolve em <code>{`"outcome": "sem_debito"`}</code>. Resultado não declarado segue o destino de erro. Ação que não está disponível na conversa (desativada, sem o pacote, abaixo do nível mínimo) também segue o de erro.
      </p>
      <p>
        <strong>Só no roteiro:</strong> marcada no cadastro da ação, a IA só recebe a ação no passo dela, de um roteiro ligado; desligar o roteiro tira a ação junto. Desmarcada, a IA usa a ação sempre que a conversa precisar, com ou sem roteiro.
      </p>

      <H2 id="identificar">Identificar a pessoa</H2>
      <p>
        A ação do passo pode dizer quem é a pessoa: devolva <code>identity</code> junto do <code>data</code>. Quantos dados pedir para identificar (CPF, CEP de um endereço, data de nascimento) é decisão do seu sistema: o roteiro pede, a sua ação decide.
      </p>
      <Code lang="json · resposta da ação" code={IDENTITY} />
      <Table
        head={["Campo", "Regras"]}
        rows={[
          [<code key="e">external_id</code>, "Obrigatório. O id da pessoa no seu sistema, texto ou número, até 200 caracteres."],
          [<code key="n">name</code>, "Até 60 caracteres. É o nome que aparece no “Estou falando com…?” (mande só o primeiro nome, se preferir)."],
          [<code key="a">accounts</code>, <>Até 10 contas da pessoa: <code key="l">label</code> (até 60, o que ela vê no botão) e <code key="c">context</code> (objeto até 2 KB, que vai para as ações). Sem contas, a pessoa fica identificada sem contexto.</>],
        ]}
      />
      <ul>
        <li>A identidade só vale vinda do passo de ação de um roteiro em andamento. A do token do site e a do pareamento vencem.</li>
        <li>
          A conversa fica identificada por 24 horas, já na mesma resposta: as próximas ações recebem <code>contact.level</code> <code>usuario</code>, <code>verified_by</code> <code>routine</code>, o <code>external_id</code> e o <code>display</code>, e <code>{`context: {source: "routine", data}`}</code> da conta escolhida.
        </li>
        <li>Com 2 contas ou mais, o roteiro espera a pessoa escolher pelos botões das contas. Depois, ela troca pedindo (“é sobre a outra conta”).</li>
        <li>
          Passos de dado e de ação marcados <strong>Pular se a pessoa já estiver identificada</strong> ficam para trás quando a conversa já tem a pessoa (número lembrado e confirmado, pareamento ou token): use nos dados que servem só para identificar.
        </li>
      </ul>
      <H3 id="lembrar">Lembrar o número</H3>
      <p>
        No WhatsApp e no Instagram, depois da identificação, o BoaVoz pede licença com os botões <strong>Lembrar este número</strong> e <strong>Não lembrar</strong>, logo depois da primeira resposta sem botões. Sem a licença, a identificação vale só para a conversa.
      </p>
      <ul>
        <li>
          Com o número lembrado, toda conversa nova começa por “Estou falando com Ana?”, com <strong>Sim, sou eu</strong> e <strong>Sou outra pessoa</strong>. A mensagem que chegou espera a resposta e é respondida depois. “Sou outra pessoa” esquece o número: o titular pode ter mudado.
        </li>
        <li>“desconectar” no chat também esquece o número e tira a identificação da conversa.</li>
        <li>
          A loja pode desligar em Roteiros → <strong>Lembrar o número depois da identificação</strong>: o BoaVoz deixa de perguntar e esquece os números já lembrados do chatbot.
        </li>
        <li>
          Seu sistema recebe <code>contact.linked</code> com <code>{`"source": "routine"`}</code> (um por conta) e <code>contact.unlinked</code> com o motivo (<code>other_person</code>, <code>chat</code>, <code>remember_off</code>…). Veja <Link href="/docs/webhooks">Webhooks</Link>.
        </li>
      </ul>

      <H2 id="foto">Pedir uma foto</H2>
      <ul>
        <li>Só no WhatsApp e no Instagram, pela leitura de fotos. No site, ou no modo dados sensíveis (sem leitura de fotos), o passo é pulado.</li>
        <li>
          O BoaVoz confere se a foto mostra o que o passo pede. Se mostra, o passo anda sozinho e a descrição vai para a variável (e para a ação com um parâmetro do mesmo nome). Se não, conta tentativa (3, como no dado), e a IA pede outra dizendo o que faltou.
        </li>
        <li>A ação recebe a descrição, não o arquivo. A equipe vê a foto no painel.</li>
        <li>Documento pessoal, cartão, comprovante de pagamento e foto de saúde não são lidos (vão para a equipe com um texto fixo), e o editor recusa o passo que pede esses tipos.</li>
        <li>Cada foto lida conta como uma resposta do atendimento.</li>
      </ul>

      <H2 id="fim">Fim do roteiro</H2>
      <Table
        head={["Como acaba", "Quando"]}
        rows={[
          ["concluído", "Chegou ao fim (o destino “encerrar” ou o último passo)."],
          [<code key="h">handoff</code>, "Foi para a equipe: o destino “chamar atendente”, o pedido da pessoa, o Assumir, a pausa da IA ou a resposta pelo celular."],
          [<code key="c">cancelled</code>, "A pessoa cancelou."],
          [<code key="t">timeout</code>, "24 horas sem mensagem do contato."],
          [<code key="i">idle</code>, "4 mensagens seguidas do contato sem o roteiro andar: a conversa seguiu outro assunto."],
          [<code key="r">replaced</code>, "Outro roteiro começou no meio."],
          [<code key="rc">routine_changed</code>, "O roteiro foi editado, desligado ou apagado."],
          [<code key="s">step_unavailable</code>, "A ação do passo não estava disponível."],
          [<code key="cc">context_changed</code>, "A conta ou a pessoa da conversa mudou (troca de conta, desconectar)."],
        ]}
      />
      <p>Os dados que o roteiro juntou são apagados no fim.</p>

      <H2 id="eventos">Webhooks</H2>
      <p>
        <code>routine.completed</code> quando o roteiro chega ao fim, e <code>routine.abandoned</code> quando acaba antes, com o <code>reason</code> da tabela acima. Os dois levam o roteiro e a execução (<code>started_by</code>: <code>keyword</code> ou <code>ai</code>; o passo em que acabou). Os dados que o roteiro juntou não vão no evento: a sua ação já recebe o que precisa no passo dela.
      </p>
      <Code lang="json · routine.completed" code={EVENT} />

      <H2 id="limites">Limites</H2>
      <ul>
        <li>10 roteiros por chatbot e 12 passos por roteiro.</li>
        <li>5 palavras-chave por roteiro, de até 3 palavras. Palavras de descadastro, confirmação e atendimento (SAIR, PARAR, STOP, sim, não, ok, cancelar, atendente, menu, oi…) nunca são palavra-chave.</li>
        <li>Botões: de 2 a 10 opções, com até 20 caracteres cada (o limite do WhatsApp e do Instagram).</li>
        <li>3 tentativas por dado ou foto; 24 horas sem mensagem do contato; 4 mensagens seguidas sem o roteiro andar.</li>
      </ul>

      <NextSteps
        items={[
          { href: "/docs/acoes", title: "Ações", text: "O endpoint que o passo de ação chama." },
          { href: "/docs/webhooks", title: "Webhooks", text: "routine.completed, routine.abandoned e os eventos de contato." },
        ]}
      />
    </DocPage>
  );
}
