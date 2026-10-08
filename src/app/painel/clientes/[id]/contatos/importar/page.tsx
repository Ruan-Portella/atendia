import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/team";
import { IMPORT_MAX_ROWS } from "@/lib/contact-import";
import { ContactImport } from "@/components/contact-import";
import { importClientContacts } from "../../../../actions";

export const metadata = { title: "Importar contatos" };
// até 2.000 contatos com aceite e idade numa requisição
export const maxDuration = 60;

const COLUMNS: Array<[string, string]> = [
  ["telefone", "Obrigatório. DDD e número (ex.: 21 99999-0000); outro país, com o código do país."],
  ["nome", "Opcional."],
  ["etiquetas", "Opcional. Separadas por vírgula (ex.: vip, delivery)."],
  ["aceite_origem", "Onde a pessoa aceitou receber novidades (ex.: cadastro no balcão). Obrigatório com o aceite."],
  ["aceite_data", "Data do aceite (ex.: 10/09/2026). Obrigatório com o aceite."],
  ["aceite_texto", "Opcional. O texto aceito; sem ele, vale o texto que você escrever na importação."],
  ["idade", "Opcional. sim (18 anos ou mais) ou não."],
  ["nascimento", "Opcional, no lugar da idade. Só serve para calcular o 18+ e não é guardada."],
  ["idade_origem", "Como a empresa sabe a idade (ex.: documento conferido). Obrigatório com idade ou nascimento."],
];

/**
 * Cliente → Contatos → Importar planilha (leva B3, parte 2b): contatos do WhatsApp com o aceite de
 * novidades (origem e data) e a idade informada pela empresa.
 */
export default async function ImportContactsPage({ params }: PageProps<"/painel/clientes/[id]/contatos/importar">) {
  const [{ id }, { role }] = await Promise.all([params, requireAgency()]);
  if (!can(role, "config")) notFound();
  const supabase = await createClient();
  // a RLS limita os chatbots ao cliente e ao escopo de quem está logado
  const [{ data: client }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("bots").select("id, name").eq("client_id", id).eq("is_demo", false).order("created_at"),
  ]);
  if (!client) notFound();
  const botIds = (bots ?? []).map((b) => b.id as string);
  const { data: channels } = botIds.length ? await createAdminClient().from("whatsapp_channels").select("bot_id").in("bot_id", botIds).is("disconnected_at", null) : { data: [] };
  const connected = new Set((channels ?? []).map((c) => c.bot_id as string));
  const withWhatsApp = (bots ?? []).filter((b) => connected.has(b.id as string)).map((b) => ({ id: b.id as string, name: b.name as string }));

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href={`/painel/clientes/${id}?tab=contatos`} className="text-sm font-semibold text-muted">← Contatos de {client.name}</Link>
        <h1 className="text-2xl font-bold sm:text-[28px]">Importar contatos</h1>
        <p className="text-sm text-muted">
          Traga os contatos que o cliente já tem, com o aceite de novidades e a idade, quando ele tiver. Até {IMPORT_MAX_ROWS.toLocaleString("pt-BR")} por planilha. Telefone que já existe no
          chatbot é completado (nome vazio e etiquetas novas), nunca duplicado.
        </p>
      </div>

      <section className="card flex flex-col gap-2 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Colunas da planilha</h2>
          <a href="/modelos/contatos.csv" download className="text-sm font-semibold text-brand hover:underline">Baixar o modelo</a>
        </div>
        <p className="text-xs text-muted">A primeira linha tem os nomes das colunas; a ordem não importa. Separador ponto e vírgula (Excel) ou vírgula.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <tbody>
              {COLUMNS.map(([name, desc]) => (
                <tr key={name} className="border-t border-line-2">
                  <td className="py-1.5 pr-3 font-mono text-xs">{name}</td>
                  <td className="py-1.5 text-ink-2">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {withWhatsApp.length ? (
        <ContactImport clientId={id} bots={withWhatsApp} action={importClientContacts} />
      ) : (
        <p className="card p-5 text-sm text-muted">Nenhum chatbot deste cliente tem o WhatsApp conectado. Conecte o número primeiro: os contatos e os aceites valem para ele.</p>
      )}
    </div>
  );
}
