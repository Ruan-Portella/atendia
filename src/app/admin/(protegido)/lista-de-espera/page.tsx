import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { StatusPill } from "@/components/ui/form-section";
import { PROFILE_LABEL, listWaitlist, waitlistMode } from "@/lib/waitlist";
import { inviteNext, inviteOne } from "./actions";

export const metadata = { title: "Lista de espera" };

const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Lista de espera (24/10/2026): quem entrou pela landing, na ordem de chegada. Convidar manda o
 * e-mail com o link de entrada; com NEXT_PUBLIC_WAITLIST=1, só o convidado cria a conta.
 */
export default async function AdminWaitlist() {
  await requireAdmin("/admin/lista-de-espera");
  const rows = await listWaitlist(createAdminClient(), 2000);
  const waiting = rows.filter((r) => !r.invited_at).length;
  const invited = rows.filter((r) => r.invited_at && !r.joined_at).length;
  const joined = rows.filter((r) => r.joined_at).length;
  const byProfile = (["agency", "business", "saas"] as const).map((p) => `${rows.filter((r) => r.profile === p).length} ${PROFILE_LABEL[p].toLowerCase()}`).join(" · ");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-normal">Lista de espera</h1>
          <p className="text-sm text-muted">
            Quem entrou pela landing, na ordem de chegada. {waitlistMode() ? "A lista está ligada neste ambiente: só quem foi convidado cria a conta." : "A lista está desligada neste ambiente (NEXT_PUBLIC_WAITLIST): o cadastro está aberto."}
          </p>
        </div>
        <ActionForm action={inviteNext} className="flex items-center gap-2">
          <input name="count" type="number" min={1} max={200} defaultValue={10} className="input w-20" aria-label="Quantas pessoas convidar" />
          <SubmitButton className="btn-primary" pendingLabel="Convidando…">Convidar os próximos</SubmitButton>
        </ActionForm>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Na fila", waiting],
          ["Convidados", invited],
          ["Já entraram", joined],
          ["Por perfil", byProfile],
        ].map(([label, value]) => (
          <div key={String(label)} className="card flex flex-col gap-1 p-4">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</span>
            <span className="display text-2xl">{value}</span>
          </div>
        ))}
      </div>

      <section className="card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted">Ninguém na lista ainda.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-[0.06em] text-muted">
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Pessoa</th>
                <th className="px-4 py-3 font-semibold">Perfil</th>
                <th className="px-4 py-3 font-semibold">Tamanho</th>
                <th className="px-4 py-3 font-semibold">Entrou em</th>
                <th className="px-4 py-3 font-semibold">Situação</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-muted">{i + 1}</td>
                  <td className="px-4 py-3">
                    <span className="block font-medium">{r.name ?? r.email}</span>
                    <span className="block text-xs text-muted">{r.name ? r.email : ""}{r.company ? `${r.name ? " · " : ""}${r.company}` : ""}</span>
                  </td>
                  <td className="px-4 py-3">{PROFILE_LABEL[r.profile] ?? r.profile}</td>
                  <td className="px-4 py-3 text-muted">{r.size_band ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{dt(r.created_at)}</td>
                  <td className="px-4 py-3">
                    {r.joined_at ? <StatusPill tone="ok">Entrou</StatusPill> : r.invited_at ? <StatusPill tone="warn">Convidado em {dt(r.invited_at)}</StatusPill> : <StatusPill>Na fila</StatusPill>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!r.invited_at && (
                      <ActionForm action={inviteOne.bind(null, r.id)}>
                        <SubmitButton className="btn-ghost text-xs" pendingLabel="Convidando…">Convidar</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
