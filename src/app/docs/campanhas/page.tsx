import Link from "next/link";
import { Code, DocPage, H2, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Campanhas e consentimento" };

const CONSENT = `
POST /v1/contacts/phone:5511999990000/consent
{
  "bot_id": "bot_…",
  "channel": "whatsapp",
  "granted": true,
  "source": "cadastro no site, caixa marcada",
  "text": "Quero receber novidades e promoções da Loja X pelo WhatsApp.",
  "collected_at": "2026-10-10T14:22:00-03:00"
}

→ 201 { "consent_id": "…" }
`;

const REMINDERS = `
POST /v1/campaigns
Idempotency-Key: 8a1b…
{
  "bot_id": "bot_…",
  "channel": "whatsapp",
  "kind": "utility_reminder",
  "template": { "name": "lembrete_consulta", "language": "pt_BR" },
  "sends": [
    { "contact": "phone:5511999990000", "send_at": "2026-10-20T09:00:00-03:00", "variables": ["Ruan", "21/10 às 14h"] },
    { "contact": "ext:paciente_1182", "send_at": "2026-10-20T09:00:00-03:00", "variables": ["Bia", "21/10 às 16h"] }
  ]
}
`;

/** Campanhas e consentimento (spec Peça 7). */
export default function CampaignsDocs() {
  return (
    <DocPage
      title="Campanhas e consentimento"
      intro="Mensagens que o negócio manda primeiro, fora da conversa: novidades e promoções para quem aceitou, e lembretes (consulta, vencimento, entrega). No MVP, só pelo WhatsApp e só com modelo aprovado pela Meta."
    >
      <H2 id="tipos">Novidades e lembretes</H2>
      <Table
        head={["Tipo", "Para quem", "Modelo"]}
        rows={[
          [<><strong>Novidades</strong> (<code>marketing</code>)</>, "Só quem aceitou receber novidades. Com bebida alcoólica ou remédio, só quem também confirmou ter 18 anos.", "Categoria marketing."],
          [<><strong>Lembretes</strong> (<code>utility_reminder</code>)</>, "Quem tem um compromisso com o negócio. Para quem nunca conversou com o chatbot, o cliente precisa ter feito a declaração de lembretes (uma vez, no painel).", "Categoria utilidade."],
        ]}
      />
      <p>
        Pelo painel: aba <strong>Campanhas</strong> do cliente. Pela API: <code>POST /v1/campaigns</code> (veja a <Link href="/docs/api#campanhas">referência</Link>). Os dois usam o mesmo motor, que confere tudo de novo na hora de cada envio.
      </p>

      <H2 id="aceite">O aceite de novidades</H2>
      <p>Cada sim e cada não fica guardado com a prova: de onde veio, o texto que a pessoa viu e a data. O registro sobrevive à exclusão do contato.</p>
      <Table
        head={["Origem", "Como"]}
        rows={[
          ["Conversa", "Com a opção ligada no chatbot, o assistente oferece novidades uma vez por contato, no fim natural da conversa, com os botões “Sim, quero” e “Não, obrigado”. A IA nunca dispara marketing: só faz a oferta."],
          ["Site", "Quem deixa o WhatsApp no chat do site recebe a mesma oferta."],
          ["Painel", "A agência registra o aceite coletado fora do chat, no contato ou ao importar uma planilha."],
          ["API", "Seu sistema registra o aceite que coletou (cadastro, checkout), com a prova."],
        ]}
      />
      <Code lang="http" code={CONSENT} />
      <p>
        <code>source</code> (3 a 200 caracteres) diz onde a pessoa aceitou; <code>text</code> (10 a 1.000), o que ela aceitou. <code>{`"granted": false`}</code> retira o aceite. O sim pela API não tira ninguém do descadastro: só um novo sim da própria pessoa, no chat.
      </p>

      <H2 id="descadastro">Descadastro</H2>
      <ul>
        <li>
          A pessoa responde <strong>SAIR</strong>, <strong>PARAR</strong> ou <strong>STOP</strong>, toca em “Parar promoções” ou para o marketing pelo próprio WhatsApp. O BoaVoz confirma (“Feito, você não vai mais receber…”) e o atendimento continua normal.
        </li>
        <li>O alcance segue a categoria do último modelo que ela recebeu: um SAIR depois de uma promoção para as promoções; depois de um lembrete, os lembretes.</li>
        <li>Errou? “Foi engano” desfaz e grava um novo sim.</li>
        <li>
          Vale para todos os chatbots do mesmo número. O webhook <code>contact.opted_out</code> avisa o seu sistema, e envio pela API para quem saiu volta 422 <code>contact_opted_out</code>.
        </li>
      </ul>

      <H2 id="lembretes-api">Lembretes pela API</H2>
      <Code lang="http" code={REMINDERS} />
      <ul>
        <li>Cada envio tem o seu contato, horário e variáveis (na ordem dos {"{{1}}"}, {"{{2}}"}… do modelo).</li>
        <li>A resposta traz a estimativa de contatos e de custo na Meta. A Idempotency-Key é obrigatória: repetir a chamada não duplica a campanha.</li>
        <li>Quem pediu para sair é pulado; o <code>campaign.finished</code> traz os totais, com os pulados por motivo.</li>
      </ul>

      <H2 id="regras">Regras da Meta que o BoaVoz cuida</H2>
      <ul>
        <li>Limite de contatos únicos por 24 horas do número (o nível da conta na Meta), somando todas as campanhas e lembretes dos chatbots do mesmo número.</li>
        <li>A campanha pausa sozinha, e o dono é avisado, se a nota de qualidade do número cair ou se a Meta pausar ou reclassificar o modelo (lembrete cobrado como marketing).</li>
        <li>Envio sem resposta da Meta fica incerto e nunca é reenviado sozinho.</li>
      </ul>
      <Note title="Custo">
        A Meta cobra cada mensagem de modelo, à parte da assinatura do BoaVoz. O painel e a API mostram a estimativa antes de agendar.
      </Note>

      <NextSteps
        items={[
          { href: "/docs/api#campanhas", title: "Referência da API", text: "POST /v1/campaigns, GET da campanha e o aceite." },
          { href: "/docs/webhooks#contato", title: "Webhooks", text: "contact.opted_in, contact.opted_out e campaign.finished." },
        ]}
      />
    </DocPage>
  );
}
