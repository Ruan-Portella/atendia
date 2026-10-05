import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ROLE_HINTS, ROLE_LABELS, attendantOf, scopesOf } from "@/lib/team";
import { DEFAULT_ENTRY_NOTICE } from "@/lib/handoff-hours";
import { isOurAvatarUrl } from "@/lib/attendants";
import { ProfileForm } from "@/components/profile-form";
import { MfaSection } from "../seguranca/mfa-section";
import { updateMyProfile } from "./actions";

export const metadata = { title: "Meu perfil" };

/**
 * Meu perfil (leva B1'): nome de exibição e foto (o que o contato vê quando você atende), quem é
 * você na equipe (papel e escopo) e o seu segundo fator, que todo papel usa ao abrir conversa de
 * chatbot em modo dados sensíveis.
 */
export default async function ProfilePage() {
  const { agency, member, role, email } = await requireAgency();
  // um cliente que a pessoa atende, só para a prévia do anúncio
  const { data: sample } = await (await createClient()).from("clients").select("name").order("name").limit(1).maybeSingle();
  let scope = "Todos os clientes da agência";
  if (member.scope === "selected") {
    const s = (await scopesOf(createAdminClient(), [member.id])).get(member.id) ?? { clientIds: [], botIds: [] };
    // nomes pela sessão: só o que a pessoa enxerga
    const supabase = await createClient();
    const [{ data: clients }, { data: bots }] = await Promise.all([
      s.clientIds.length ? supabase.from("clients").select("name").in("id", s.clientIds) : Promise.resolve({ data: [] }),
      s.botIds.length ? supabase.from("bots").select("name, client_name").in("id", s.botIds) : Promise.resolve({ data: [] }),
    ]);
    const names = [...(clients ?? []).map((c) => String(c.name)), ...(bots ?? []).map((b) => `${b.name} (${b.client_name})`)];
    scope = names.length ? names.join(", ") : "Nenhum cliente ainda";
  }
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-[28px]">Meu perfil</h1>
        <p className="text-sm text-muted">Como você aparece para os contatos e como entra no painel de {agency.name}.</p>
      </div>
      <ProfileForm
        action={updateMyProfile}
        folder={member.id}
        name={attendantOf(member).name}
        avatar={isOurAvatarUrl(member.avatar_url) ? member.avatar_url : null}
        entryExample={DEFAULT_ENTRY_NOTICE}
        company={(sample?.name as string | undefined) ?? "sua empresa cliente"}
      />
      <section className="card flex flex-col gap-3 p-6 text-sm">
        <div className="grid gap-1 sm:grid-cols-[140px_1fr]"><span className="text-muted">E-mail</span><span className="font-semibold">{email}</span></div>
        <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
          <span className="text-muted">Papel</span>
          <span><span className="font-semibold">{ROLE_LABELS[role]}</span>{role !== "owner" && <span className="block text-xs text-muted">{ROLE_HINTS[role]}</span>}</span>
        </div>
        <div className="grid gap-1 sm:grid-cols-[140px_1fr]"><span className="text-muted">Escopo</span><span>{scope}</span></div>
        {role !== "owner" && <p className="text-xs text-muted">Para mudar o papel ou o escopo, fale com o dono ou um administrador da agência.</p>}
      </section>
      <MfaSection enrollHref={`/painel/verificar?next=${encodeURIComponent("/painel/perfil")}`} />
    </div>
  );
}
