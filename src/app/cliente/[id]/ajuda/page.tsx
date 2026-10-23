import { memberCan, requireMember } from "@/lib/member";
import { clientGuide } from "@/lib/client-guide";
import { ChevronDown } from "lucide-react";

export const metadata = { title: { absolute: "Ajuda" }, robots: { index: false, follow: false } };

/** Como usar a área do cliente (Lançamento, parte 2): com a marca da agência, só o que a pessoa tem liberado. */
export default async function MemberHelpPage({ params }: PageProps<"/cliente/[id]/ajuda">) {
  const { id } = await params;
  const { member } = await requireMember(id);
  const sections = clientGuide(
    { manager: memberCan(member, "manager"), handoff: member.allowHandoff, knowledge: member.allowKnowledge, hours: member.allowHours },
    { agency: member.agency.name, client: member.clientName },
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-normal">Ajuda</h1>
        <p className="text-sm text-muted">Como usar esta área, do jeito que a {member.agency.name} liberou para você.</p>
      </div>
      {/* redesenho (23/10/2026): cada assunto numa linha que abre e fecha, no lugar dos cartões longos */}
      <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
        {sections.map((s, i) => (
          <details key={s.id} id={s.id} open={i === 0} className="group/help scroll-mt-6">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition-colors duration-[120ms] hover:bg-raised/40 [&::-webkit-details-marker]:hidden">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-raised font-mono text-[12px] text-ink-2">{i + 1}</span>
              <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">{s.title}</span>
              <ChevronDown size={16} className="shrink-0 text-muted transition-transform duration-[220ms] group-open/help:rotate-180" />
            </summary>
            <div className="flex flex-col gap-2 px-4 pb-4 pl-[60px]">
              {s.paragraphs.map((p) => (
                <p key={p} className="text-sm leading-relaxed text-ink-2">
                  {p}
                </p>
              ))}
            </div>
          </details>
        ))}
      </div>
      {member.agency.support_whatsapp && (
        <p className="text-sm text-muted">
          Ficou alguma dúvida? Fale com a {member.agency.name} pelo WhatsApp: <a href={`https://wa.me/${member.agency.support_whatsapp}`} className="font-semibold text-brand underline">abrir conversa</a>.
        </p>
      )}
    </>
  );
}
