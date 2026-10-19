import { memberCan, requireMember } from "@/lib/member";
import { clientGuide } from "@/lib/client-guide";

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
        <h1 className="text-2xl font-bold">Ajuda</h1>
        <p className="text-sm text-muted">Como usar esta área, do jeito que a {member.agency.name} liberou para você.</p>
      </div>
      <nav aria-label="Assuntos" className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line bg-white px-3 py-1 text-sm text-ink-2 hover:border-brand">
            {s.title}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-4">
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="card flex scroll-mt-6 flex-col gap-2 p-6">
            <h2 className="text-base font-bold">{s.title}</h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="text-sm leading-relaxed text-ink-2">
                {p}
              </p>
            ))}
          </section>
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
