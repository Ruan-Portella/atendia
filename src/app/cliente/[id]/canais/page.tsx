import { requireMember } from "@/lib/member";
import { relativeTime } from "@/lib/utils";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { memberDisconnectChannel } from "../../actions";

export const metadata = { title: { absolute: "Canais" }, robots: { index: false, follow: false } };

interface Row {
  bot_id: string;
  disconnected_at: string | null;
}

/**
 * Canais do negócio (L1): os números do WhatsApp e as contas do Instagram ligados aos assistentes
 * dele, com o botão de desconectar. O número e a conta continuam do negócio na Meta.
 */
export default async function MemberChannelsPage({ params }: PageProps<"/cliente/[id]/canais">) {
  const { id } = await params;
  const { member, admin, botIds } = await requireMember(id);
  const ids = botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: bots }, { data: wa }, { data: ig }] = await Promise.all([
    admin.from("bots").select("id, name").in("id", ids).order("name"),
    admin.from("whatsapp_channels").select("bot_id, display_phone, verified_name, coexistence, disconnected_at").in("bot_id", ids),
    admin.from("instagram_channels").select("bot_id, username, disconnected_at").in("bot_id", ids),
  ]);
  const waBy = new Map(((wa ?? []) as Array<Row & { display_phone: string | null; verified_name: string | null; coexistence: boolean }>).map((w) => [w.bot_id, w]));
  const igBy = new Map(((ig ?? []) as Array<Row & { username: string | null }>).map((i) => [i.bot_id, i]));
  const withChannel = (bots ?? []).filter((b) => waBy.has(b.id as string) || igBy.has(b.id as string));

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Canais</h1>
        <p className="text-sm text-muted">
          WhatsApp e Instagram ligados aos assistentes de {member.clientName}. Desconectar faz o assistente parar de responder por ali na hora; o número e a conta continuam seus na Meta, e as conversas antigas ficam guardadas. Para conectar de novo, fale com {member.agency.name}.
        </p>
      </div>
      {withChannel.length === 0 ? (
        <p className="card p-5 text-sm text-muted">Nenhum WhatsApp ou Instagram conectado.</p>
      ) : (
        <div className="card divide-y divide-line-2">
          {withChannel.map((b) => {
            const w = waBy.get(b.id as string);
            const i = igBy.get(b.id as string);
            return (
              <div key={b.id as string} className="flex flex-col gap-3 p-5">
                <div className="font-semibold">{b.name as string}</div>
                {w && (
                  <ChannelLine
                    label="WhatsApp"
                    value={`${w.display_phone ?? "número"}${w.verified_name ? ` · ${w.verified_name}` : ""}${w.coexistence ? " · também no app do celular" : ""}`}
                    disconnectedAt={w.disconnected_at}
                    action={memberDisconnectChannel.bind(null, id, b.id as string, "whatsapp")}
                  />
                )}
                {i && (
                  <ChannelLine
                    label="Instagram"
                    value={i.username ? `@${i.username}` : "conta conectada"}
                    disconnectedAt={i.disconnected_at}
                    action={memberDisconnectChannel.bind(null, id, b.id as string, "instagram")}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function ChannelLine({ label, value, disconnectedAt, action }: { label: string; value: string; disconnectedAt: string | null; action: () => Promise<import("@/lib/action-result").ActionResult> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <span className="w-20 text-muted">{label}</span>
      <span className="font-medium">{value}</span>
      {disconnectedAt ? (
        <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">desconectado {relativeTime(disconnectedAt)}</span>
      ) : (
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">conectado</span>
      )}
      <ConfirmAction
        action={action}
        title={`${disconnectedAt ? "Remover" : "Desconectar"} o ${label}?`}
        description={`O assistente para de responder pelo ${label} na hora. Nada é apagado na Meta: o número e a conta continuam seus. A agência é avisada por e-mail.`}
        confirmLabel={disconnectedAt ? "Remover" : "Desconectar"}
        className="ml-auto text-xs font-semibold text-danger hover:underline"
      >
        {disconnectedAt ? "Remover" : "Desconectar"}
      </ConfirmAction>
    </div>
  );
}
