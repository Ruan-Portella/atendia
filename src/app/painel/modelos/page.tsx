import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/team";
import { relativeTime } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { createTemplateAction } from "./actions";

export const metadata = { title: "Modelos de chatbot" };

/**
 * Modelos de chatbot (D', parte 2b): o que vários chatbots têm em comum, num lugar só. Com o pacote
 * Plataforma, para quem cuida da configuração e vê a conta inteira.
 */
export default async function TemplatesPage() {
  const { agency, role, member, packs } = await requireAgency();
  const allowed = can(role, "config") && member.scope === "all";
  const pack = packs.includes("plataforma");
  const supabase = await createClient();
  const [{ data: templates }, { data: derived }] =
    allowed
      ? await Promise.all([
          supabase.from("bots").select("id, name, updated_at").eq("is_template", true).order("created_at"),
          createAdminClient().from("bots").select("template_id").eq("agency_id", agency.id).not("template_id", "is", null),
        ])
      : [{ data: [] }, { data: [] }];
  const count = new Map<string, number>();
  for (const d of derived ?? []) count.set(String(d.template_id), (count.get(String(d.template_id)) ?? 0) + 1);

  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-[28px]">Modelos de chatbot</h1>
        <p className="text-sm text-muted">
          Um modelo junta o que vários chatbots têm em comum: a personalidade, as instruções, as ações, os roteiros e a base de conhecimento. Cada chatbot criado dele (um por cliente ou por loja) recebe as mudanças na hora e muda só o que o modelo libera, como o nome, a saudação e a base própria.
        </p>
      </div>

      {!allowed ? (
        <p className="card p-5 text-sm text-muted">Os modelos são de quem cuida da configuração e vê todos os clientes da conta.</p>
      ) : !pack ? (
        <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          Os modelos de chatbot fazem parte do pacote Plataforma, junto com a criação de lojas pela API. <Link href="/painel/cobranca" className="font-semibold underline">Assinar em Cobrança</Link>.
        </p>
      ) : (
        <>
          <section className="card flex flex-col">
            {(templates ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhum modelo ainda.</p>}
            {(templates ?? []).map((t) => (
              <Link key={t.id as string} href={`/painel/bots/${t.id}?tab=heranca`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-5 py-3 text-sm last:border-0 hover:bg-ground">
                <span className="font-semibold">{t.name as string}</span>
                <span className="text-muted">
                  {count.get(t.id as string) ?? 0} chatbot{(count.get(t.id as string) ?? 0) === 1 ? "" : "s"} derivado{(count.get(t.id as string) ?? 0) === 1 ? "" : "s"}
                </span>
                <span className="ml-auto text-xs text-muted">alterado {relativeTime(t.updated_at as string)}</span>
              </Link>
            ))}
          </section>

          <section className="card flex flex-col gap-3 p-5">
            <h2 className="text-base font-bold">Novo modelo</h2>
            <ActionForm action={createTemplateAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="template-name" className="label">Nome do assistente (os derivados começam com ele)</label>
                <input id="template-name" name="name" required maxLength={60} className="input" placeholder="Duda" />
              </div>
              <SubmitButton className="btn-primary" pendingLabel="Criando…">Criar modelo</SubmitButton>
            </ActionForm>
          </section>
        </>
      )}
    </div>
  );
}
