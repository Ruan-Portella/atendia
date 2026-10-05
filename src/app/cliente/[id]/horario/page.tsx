import { requireMember } from "@/lib/member";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { HoursFields } from "@/components/hours-fields";
import type { HumanHandoff } from "@/lib/handoff-hours";
import { memberSetHours } from "../../actions";

export const metadata = { title: { absolute: "Horário de atendimento" }, robots: { index: false, follow: false } };

/**
 * Horário de atendimento (leva B1'): o gestor ajusta, quando a agência libera. Fora do horário, o
 * pedido de atendente fica registrado e o assistente diz quando a equipe volta.
 */
export default async function MemberHoursPage({ params }: PageProps<"/cliente/[id]/horario">) {
  const { id } = await params;
  const { member, admin, botIds } = await requireMember(id, "hours");
  const { data } = await admin.from("bots").select("id, name, human_handoff").in("id", botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"]).order("name");
  const bots = (data ?? []) as Array<{ id: string; name: string; human_handoff: HumanHandoff | null }>;
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Horário de atendimento</h1>
        <p className="text-sm text-muted">
          Quando a equipe de {member.clientName} atende, no horário de Brasília. Fora dele, quem pedir para falar com uma pessoa fica registrado e o assistente diz quando a equipe volta. Dia em branco = fechado; tudo em branco = sem horário (o assistente só diz que a equipe responde assim que possível).
        </p>
      </div>
      {bots.length === 0 && <p className="card p-5 text-sm text-muted">Nenhum assistente ainda.</p>}
      {bots.map((b) => (
        <ActionForm key={b.id} action={memberSetHours.bind(null, id, b.id)} className="card flex flex-col gap-3 p-5">
          <h2 className="text-base font-bold">{b.name}</h2>
          <HoursFields hours={b.human_handoff?.hours} />
          <SubmitButton pendingLabel="Salvando…" className="btn-primary self-start">Salvar horário</SubmitButton>
        </ActionForm>
      ))}
    </>
  );
}
