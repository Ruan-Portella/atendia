import Link from "next/link";
import { Code, DocPage, H2, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Exemplos" };

const BASE_NODE = `
// npm i express standardwebhooks
import express from "express";
import { Webhook } from "standardwebhooks";

const app = express();
const wh = new Webhook(process.env.BOAVOZ_ACTION_SECRET);

// uma URL para todas as ações do chatbot: o campo "action" diz qual é
const acoes = { segunda_via_boleto: segundaVia, consultar_horarios: consultarHorarios, agendar, resumo_do_mes: resumoDoMes, ver_cardapio: verCardapio, adicionar_ao_carrinho: adicionarAoCarrinho };

app.post("/boavoz/acoes", express.text({ type: "*/*" }), async (req, res) => {
  let chamada;
  try {
    chamada = wh.verify(req.body, req.headers);
  } catch {
    return res.status(401).json({ error: "assinatura inválida" });
  }
  // botão Testar do painel: sem conversa nem contato
  if (chamada.test) return res.json({ data: { teste: "ok", acao: chamada.action } });
  const acao = acoes[chamada.action];
  if (!acao) return res.status(404).json({ error: "ação desconhecida" });
  const { status, body } = await acao(chamada, req.query);
  res.status(status).json(body);
});

app.listen(3000);
`;

const BASE_PY = `
# pip install flask standardwebhooks
import os
from flask import Flask, request, jsonify
from standardwebhooks.webhooks import Webhook

app = Flask(__name__)
wh = Webhook(os.environ["BOAVOZ_ACTION_SECRET"])

@app.post("/boavoz/acoes")
def acoes():
    try:
        chamada = wh.verify(request.get_data(), dict(request.headers))
    except Exception:
        return jsonify(error="assinatura inválida"), 401
    # botão Testar do painel: sem conversa nem contato
    if chamada.get("test"):
        return jsonify(data={"teste": "ok", "acao": chamada["action"]})
    acao = ACOES.get(chamada["action"])
    if not acao:
        return jsonify(error="ação desconhecida"), 404
    status, corpo = acao(chamada, request.args)
    return jsonify(corpo), status

# no fim do arquivo, depois das funções:
# ACOES = {"segunda_via_boleto": segunda_via, "consultar_horarios": consultar_horarios, "agendar": agendar, ...}
`;

const BOLETO_NODE = `
// segunda_via_boleto: consulta · nível mínimo "usuário" · sem parâmetros
async function segundaVia(chamada) {
  const conta = await db.contas.porId(chamada.contact.external_id);
  const boleto = conta && (await db.boletos.emAberto(conta.id));
  if (!boleto) return { status: 404, body: { error: "nenhum boleto em aberto" } };
  return {
    status: 200,
    body: {
      data: { vencimento: boleto.vencimento, valor: boleto.valorFormatado },
      // link HTTPS público e de curta duração para o PDF: o BoaVoz baixa e manda como documento
      attachments: [{ url: boleto.linkAssinadoDoPdf, filename: "boleto.pdf" }],
    },
  };
}
`;

const BOLETO_PY = `
# segunda_via_boleto: consulta · nível mínimo "usuário" · sem parâmetros
def segunda_via(chamada, args):
    conta = db.contas.por_id(chamada["contact"]["external_id"])
    boleto = conta and db.boletos.em_aberto(conta.id)
    if not boleto:
        return 404, {"error": "nenhum boleto em aberto"}
    return 200, {
        "data": {"vencimento": boleto.vencimento, "valor": boleto.valor_formatado},
        "attachments": [{"url": boleto.link_assinado_do_pdf, "filename": "boleto.pdf"}],
    }
`;

const AGENDA_NODE = `
// consultar_horarios: consulta · nível "canal" · parâmetro data (AAAA-MM-DD)
async function consultarHorarios(chamada) {
  const livres = await agenda.livres(chamada.params.data);
  return { status: 200, body: { data: { data: chamada.params.data, horarios: livres } } };
}

// agendar: executa · nível "canal" · parâmetros data e horario · aceita prévia
async function agendar(chamada) {
  const { data, horario } = chamada.params;
  // o mesmo call_id volta no "Tentar de novo": devolva o que já foi feito, sem agendar de novo
  const feito = await agenda.porCallId(chamada.call_id);
  if (feito) return { status: 200, body: { data: { protocolo: feito.protocolo, data, horario } } };
  if (!(await agenda.estaLivre(data, horario))) return { status: 404, body: { error: "esse horário não está mais livre" } };
  if (chamada.mode === "preview") {
    // a prévia não cria nada: só o resumo para o Confirmar
    return { status: 200, body: { confirmation: { summary: "Corte de cabelo em " + data + " às " + horario, total_cents: 6000 } } };
  }
  const novo = await agenda.criar({ data, horario, telefone: chamada.contact.phone, callId: chamada.call_id });
  return { status: 200, body: { data: { protocolo: novo.protocolo, data, horario } } };
}
`;

const AGENDA_PY = `
# consultar_horarios: consulta · nível "canal" · parâmetro data (AAAA-MM-DD)
def consultar_horarios(chamada, args):
    data = chamada["params"]["data"]
    return 200, {"data": {"data": data, "horarios": agenda.livres(data)}}

# agendar: executa · nível "canal" · parâmetros data e horario · aceita prévia
def agendar(chamada, args):
    data, horario = chamada["params"]["data"], chamada["params"]["horario"]
    feito = agenda.por_call_id(chamada["call_id"])  # "Tentar de novo" traz o mesmo call_id
    if feito:
        return 200, {"data": {"protocolo": feito.protocolo, "data": data, "horario": horario}}
    if not agenda.esta_livre(data, horario):
        return 404, {"error": "esse horário não está mais livre"}
    if chamada.get("mode") == "preview":
        return 200, {"confirmation": {"summary": "Corte de cabelo em " + data + " às " + horario, "total_cents": 6000}}
    novo = agenda.criar(data=data, horario=horario, telefone=chamada["contact"]["phone"], call_id=chamada["call_id"])
    return 200, {"data": {"protocolo": novo.protocolo, "data": data, "horario": horario}}
`;

const FINANCAS_NODE = `
// resumo_do_mes: consulta · nível "usuário" · exige contexto assinado · parâmetro mes (AAAA-MM)
async function resumoDoMes(chamada) {
  const usuario = chamada.contact.external_id;
  const workspace = chamada.context?.data?.workspace_id;
  // a conta vem do vínculo assinado; ainda assim, confira que ela é membro do workspace
  if (!(await workspaces.temMembro(workspace, usuario))) return { status: 404, body: { error: "workspace não encontrado" } };
  const r = await financas.resumo(workspace, chamada.params.mes);
  return {
    status: 200,
    body: {
      data: { mes: r.mes, gasto: r.gasto, por_categoria: r.categorias, saldo_previsto: r.saldoPrevisto },
      // a IA leva em conta, mas nunca escreve
      internal: { limite_do_cartao: r.limiteDoCartao },
    },
  };
}
`;

const FINANCAS_PY = `
# resumo_do_mes: consulta · nível "usuário" · exige contexto assinado · parâmetro mes (AAAA-MM)
def resumo_do_mes(chamada, args):
    usuario = chamada["contact"]["external_id"]
    workspace = ((chamada.get("context") or {}).get("data") or {}).get("workspace_id")
    if not workspaces.tem_membro(workspace, usuario):
        return 404, {"error": "workspace não encontrado"}
    r = financas.resumo(workspace, chamada["params"]["mes"])
    return 200, {
        "data": {"mes": r.mes, "gasto": r.gasto, "por_categoria": r.categorias, "saldo_previsto": r.saldo_previsto},
        "internal": {"limite_do_cartao": r.limite_do_cartao},
    }
`;

const CARDAPIO_NODE = `
// ver_cardapio: consulta · nível "anônimo" · a URL de cada chatbot leva a loja: .../boavoz/acoes?loja=123
async function verCardapio(chamada, query) {
  const itens = await cardapio.daLoja(query.loja);
  return {
    status: 200,
    body: {
      data: { itens: itens.map((i) => ({ id: i.id, nome: i.nome, preco: i.precoFormatado })) },
      components: {
        type: "carousel",
        cards: itens.slice(0, 10).map((i) => ({
          image: i.fotoUrl,
          title: i.nome,
          text: (i.precoFormatado + ". " + i.descricao).slice(0, 300),
          buttons: [{ title: "Pedir este", action: { name: "adicionar_ao_carrinho", params: { item: i.id } } }],
        })),
      },
    },
  };
}

// adicionar_ao_carrinho: consulta (não cria pedido) · parâmetro item
async function adicionarAoCarrinho(chamada, query) {
  const dono = chamada.contact?.phone ?? chamada.conversation.id;
  const carrinho = await carrinhos.adicionar(query.loja, dono, chamada.params.item);
  return {
    status: 200,
    body: {
      reply: "Coloquei 1x " + carrinho.ultimoItem + " no carrinho. Total: " + carrinho.totalFormatado + ". Quer finalizar?",
      components: {
        type: "buttons",
        buttons: [
          { title: "Finalizar pedido", action: { name: "criar_pedido", params: { carrinho: carrinho.id } } },
          { title: "Ver cardápio", id: "ver_cardapio" },
        ],
      },
    },
  };
}
`;

const CARDAPIO_PY = `
# ver_cardapio: consulta · nível "anônimo" · a URL de cada chatbot leva a loja: .../boavoz/acoes?loja=123
def ver_cardapio(chamada, args):
    itens = cardapio.da_loja(args["loja"])
    return 200, {
        "data": {"itens": [{"id": i.id, "nome": i.nome, "preco": i.preco_formatado} for i in itens]},
        "components": {
            "type": "carousel",
            "cards": [
                {
                    "image": i.foto_url,
                    "title": i.nome,
                    "text": (i.preco_formatado + ". " + i.descricao)[:300],
                    "buttons": [{"title": "Pedir este", "action": {"name": "adicionar_ao_carrinho", "params": {"item": i.id}}}],
                }
                for i in itens[:10]
            ],
        },
    }

# adicionar_ao_carrinho: consulta (não cria pedido) · parâmetro item
def adicionar_ao_carrinho(chamada, args):
    dono = (chamada.get("contact") or {}).get("phone") or chamada["conversation"]["id"]
    carrinho = carrinhos.adicionar(args["loja"], dono, chamada["params"]["item"])
    return 200, {
        "reply": "Coloquei 1x " + carrinho.ultimo_item + " no carrinho. Total: " + carrinho.total_formatado + ". Quer finalizar?",
        "components": {
            "type": "buttons",
            "buttons": [
                {"title": "Finalizar pedido", "action": {"name": "criar_pedido", "params": {"carrinho": carrinho.id}}},
                {"title": "Ver cardápio", "id": "ver_cardapio"},
            ],
        },
    }
`;

/** Exemplos em Node e Python (spec "Documentação pública": boleto, agenda, workspace e cardápio por loja). */
export default function ExamplesDocs() {
  return (
    <DocPage
      title="Exemplos"
      intro="Quatro integrações completas, em Node (Express) e Python (Flask). Os objetos db, agenda, financas e cardapio são o seu sistema: troque pelas suas consultas."
    >
      <H2 id="base">A base: uma URL para todas as ações</H2>
      <p>
        O corpo traz o nome da ação em <code>action</code>, então todas as ações do chatbot podem apontar para a mesma URL. A base confere a assinatura e chama a função certa; cada função devolve o status HTTP e o corpo.
      </p>
      <Code lang="javascript · node" code={BASE_NODE} />
      <Code lang="python · flask" code={BASE_PY} />

      <H2 id="boleto">Segunda via de boleto</H2>
      <p>
        A pessoa entrou no site (token) ou pareou o WhatsApp. Com nível mínimo <strong>usuário</strong>, a ação só aparece para quem a empresa identificou, e a conta vem do <code>external_id</code>, nunca de um CPF digitado. O PDF vai como documento logo depois do texto.
      </p>
      <Code lang="javascript · node" code={BOLETO_NODE} />
      <Code lang="python" code={BOLETO_PY} />

      <H2 id="agenda">Agenda</H2>
      <p>
        Duas ações. A consulta traz os horários livres, e a IA mostra como opções. Ao escolher, a IA chama <code>agendar</code>, que é <strong>executa</strong>: o contato vê o resumo da prévia e só no Confirmar o agendamento é criado.
      </p>
      <Code lang="javascript · node" code={AGENDA_NODE} />
      <Code lang="python" code={AGENDA_PY} />
      <Note>Guarde o <code>call_id</code> junto do agendamento. Se a resposta demorar mais de 20 segundos, o contato vê “Tentar de novo”, e a chamada volta com o mesmo id: devolva o mesmo protocolo.</Note>

      <H2 id="workspace">Faturamento por workspace</H2>
      <p>
        Uma pessoa com mais de uma conta (a família e a empresa). O <Link href="/docs/identificar-usuarios">token ou o pareamento</Link> diz a conta ativa em <code>context</code>. Com “exige contexto assinado”, a ação só aparece em conversas com contexto. O que a IA precisa considerar sem dizer vai em <code>internal</code>.
      </p>
      <Code lang="javascript · node" code={FINANCAS_NODE} />
      <Code lang="python" code={FINANCAS_PY} />

      <H2 id="cardapio">Cardápio por loja</H2>
      <p>
        Um chatbot por loja, todos apontando para a mesma URL com a loja na query. O cardápio sai em carrossel; o botão “Pedir este” chama <code>adicionar_ao_carrinho</code> direto, sem a IA, e o <code>reply</code> dela traz o resumo com “Finalizar pedido”, que chama a ação de pedido (pedido só vai em botões, nunca no carrossel).
      </p>
      <Code lang="javascript · node" code={CARDAPIO_NODE} />
      <Code lang="python" code={CARDAPIO_PY} />
      <Table
        head={["Ação", "Tipo", "Nível"]}
        rows={[
          [<code key="1">ver_cardapio</code>, "consulta", "anônimo"],
          [<code key="2">adicionar_ao_carrinho</code>, "consulta", "anônimo"],
          [<code key="3">criar_pedido</code>, "executa (o toque em Finalizar vale como confirmação)", "anônimo ou canal"],
        ]}
      />
      <Note title="Bebida alcoólica e remédio">
        No WhatsApp e no Instagram, o BoaVoz tira do carrossel os itens 18+ de quem não confirmou a idade e nunca deixa fechar no chat um pedido com esses itens: o seu sistema não precisa repetir essa regra, mas o pedido desses itens deve fechar no site, no app ou por telefone.
      </Note>

      <NextSteps
        items={[
          { href: "/docs/acoes", title: "Ações", text: "Todos os campos da chamada e da resposta." },
          { href: "/docs/seguranca", title: "Segurança", text: "Por que a conta vem do contato verificado." },
        ]}
      />
    </DocPage>
  );
}
