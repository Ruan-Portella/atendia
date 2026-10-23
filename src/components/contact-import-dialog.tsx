import { Download, Upload } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { IMPORT_MAX_ROWS } from "@/lib/contact-import";
import { ContactImport } from "@/components/contact-import";
import { DialogButton } from "@/components/ui/setting-row";
import { importClientContacts } from "@/app/painel/actions";
import { listDateFields } from "@/lib/contact-date-fields";

const COLUMNS: Array<[string, string]> = [
  ["telefone", "Obrigatório. DDD e número (ex.: 21 99999-0000); outro país, com o código do país."],
  ["nome", "Opcional."],
  ["etiquetas", "Opcional. Separadas por vírgula (ex.: vip, delivery)."],
  ["aceite_origem", "Onde a pessoa aceitou receber novidades (ex.: cadastro no balcão). Obrigatório com o aceite."],
  ["aceite_data", "Data do aceite (ex.: 10/09/2026). Obrigatório com o aceite."],
  ["aceite_texto", "Opcional. O texto aceito; sem ele, vale o texto que você escrever na importação."],
  ["idade", "Opcional. sim (18 anos ou mais) ou não."],
  ["nascimento", "Opcional, no lugar da idade (com idade_origem, calcula o 18+). Fica só o dia e o mês, como aniversário; o ano não é guardado."],
  ["idade_origem", "Como a empresa sabe a idade (ex.: documento conferido). Obrigatório com idade, e com nascimento para valer o 18+."],
  ["aniversario", "Opcional, para as réguas. Dia e mês (ex.: 21/10)."],
  ["ultima_visita", "Opcional, para as réguas. A última visita ou compra (ex.: 05/10/2026)."],
  ["agendamento", "Opcional, para as réguas. O próximo horário marcado, no fuso do cliente (ex.: 20/12/2026 14:30)."],
];

/**
 * Cliente → Contatos → Importar planilha (leva B3, parte 2b): contatos do WhatsApp com o aceite de
 * novidades (origem e data), a idade informada pela empresa e as datas das réguas (leva Réguas,
 * parte 1), com o horário marcado lido no fuso do cliente. Rodada 2 das telas (23/10/2026, a
 * pedido do usuário): num painel lateral na própria aba Contatos, em vez de uma tela à parte.
 * `bots` já vêm filtrados pela RLS (os chatbots do cliente que a pessoa vê).
 */
export async function ContactImportDialog({ clientId, bots, timezone }: { clientId: string; bots: Array<{ id: string; name: string }>; timezone: string }) {
  const botIds = bots.map((b) => b.id);
  const { data: channels } = botIds.length ? await createAdminClient().from("whatsapp_channels").select("bot_id").in("bot_id", botIds).is("disconnected_at", null) : { data: [] };
  const connected = new Set((channels ?? []).map((c) => c.bot_id as string));
  const withWhatsApp = bots.filter((b) => connected.has(b.id));
  // as datas novas das réguas personalizadas: uma coluna para cada (o nome da coluna é a chave)
  const dateFields = await listDateFields(createAdminClient(), withWhatsApp.map((b) => b.id));
  const dateColumns: Array<[string, string]> = [...new Map(dateFields.map((f) => [f.key, f])).values()].map((f) => [f.key, `Opcional, para as suas réguas: ${f.label} (ex.: 10/03/2027).${withWhatsApp.length > 1 ? ` Vale no chatbot ${withWhatsApp.find((b) => b.id === f.botId)?.name ?? ""}.` : ""}`]);
  return (
    <DialogButton
      label="Importar planilha"
      icon={<Upload size={15} />}
      className="btn-ghost"
      title="Importar contatos"
      description={`Traga os contatos que o cliente já tem, com o aceite de novidades e a idade, quando ele tiver. Até ${IMPORT_MAX_ROWS.toLocaleString("pt-BR")} por planilha. Telefone que já existe no chatbot é completado (nome vazio, etiquetas novas e as datas das réguas), nunca duplicado.`}
      size="sheet"
      footer="close"
    >
      <div className="flex flex-wrap items-center gap-2">
        <a href="/modelos/contatos.csv" download className="btn-ghost">
          <Download size={15} />
          Baixar o modelo
        </a>
      </div>
      <details className="group rounded-[14px] border border-line">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-ink">As colunas da planilha</summary>
        <p className="px-4 pb-2 text-xs text-muted">A primeira linha tem os nomes das colunas; a ordem não importa. Separador ponto e vírgula (Excel) ou vírgula.</p>
        <ul className="flex flex-col divide-y divide-line-2 border-t border-line">
          {[...COLUMNS, ...dateColumns].map(([name, desc]) => (
            <li key={name} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
              <span className="shrink-0 font-mono text-xs text-ink sm:w-[120px] sm:pt-0.5">{name}</span>
              <span className="text-sm text-ink-2">{desc}</span>
            </li>
          ))}
        </ul>
      </details>
      {withWhatsApp.length ? (
        <ContactImport clientId={clientId} bots={withWhatsApp} timezone={timezone} action={importClientContacts} dateKeys={[...new Set(dateFields.map((f) => f.key))]} />
      ) : (
        <p className="rounded-[12px] bg-raised p-4 text-sm text-muted">Nenhum chatbot deste cliente tem o WhatsApp conectado. Conecte o número primeiro: os contatos e os aceites valem para ele.</p>
      )}
    </DialogButton>
  );
}
