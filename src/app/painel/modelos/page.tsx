import Link from "next/link";
import { ChevronRight, Layers, Plus } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/team";
import { relativeTime } from "@/lib/utils";
import { BotFace } from "@/components/bot-face";
import { DialogButton } from "@/components/ui/setting-row";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { createTemplateAction } from "./actions";

export const metadata = { title: "Modelos de chatbot" };

/**
 * Modelos de chatbot (D', parte 2b): o que vários chatbots têm em comum, num lugar só. Com o pacote
 * Plataforma, para quem cuida da configuração e vê a conta inteira. Redesenho, etapa 5: cada modelo
 * numa linha com o rosto e quantos derivados tem; "Novo modelo" num modal.
 */
export default async function TemplatesPage() {
  const { agency, role, member, packs } = await requireAgency();
  const allowed = can(role, "config") && member.scope === "all";
  const pack = packs.includes("plataforma");
  const supabase = await createClient();
  const [{ data: templates }, { data: derived }] =
    allowed && pack
      ? await Promise.all([
          supabase.from("bots").select("id, name, updated_at, appearance, face").eq("is_template", true).is("version_of", null).order("created_at"),
          createAdminClient().from("bots").select("template_id").eq("agency_id", agency.id).not("template_id", "is", null),
        ])
      : [{ data: [] }, { data: [] }];
  const count = new Map<string, number>();
  for (const d of derived ?? []) count.set(String(d.template_id), (count.get(String(d.template_id)) ?? 0) + 1);
  const newButton = (
    <DialogButton label="Novo modelo" icon={<Plus size={15} />} className="btn-primary" title="Novo modelo" description="Depois de criar, o modelo abre para você configurar a personalidade, as instruções, as ações, os roteiros e a base." action={createTemplateAction} saveLabel="Criar modelo">
      <div>
        <label htmlFor="template-name" className="label">
          Nome do assistente
        </label>
        <input id="template-name" name="name" required maxLength={60} className="input" placeholder="Duda" />
        <p className="mt-1 text-xs text-muted">Os chatbots criados do modelo começam com este nome (cada um pode mudar, se o modelo liberar).</p>
      </div>
    </DialogButton>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-2xl font-normal sm:text-[28px]">Modelos de chatbot</h1>
          <p className="text-sm text-muted">O que vários chatbots têm em comum, num lugar só: publique o modelo e todos os chatbots criados dele mudam juntos.</p>
          <HowItWorks label="Como funcionam os modelos">
            <p>
              Um modelo junta a personalidade, as instruções, as ações, os roteiros e a base de conhecimento. Cada chatbot criado dele (um por cliente ou por loja) usa a versão publicada: o que você muda no modelo fica no rascunho até clicar em Publicar (a base e o
              que o modelo libera valem na hora). Cada derivado muda só o que o modelo libera, como o nome, a saudação e a base própria.
            </p>
            <p>Os chatbots derivados nascem pela API (com o pacote Plataforma) ou pela página do modelo.</p>
          </HowItWorks>
        </div>
        {allowed && pack && (templates ?? []).length > 0 && newButton}
      </div>

      {!allowed ? (
        <p className="card px-5 py-8 text-center text-sm text-muted">Os modelos são de quem cuida da configuração e vê todos os clientes da conta.</p>
      ) : !pack ? (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
            <Layers size={18} />
          </span>
          <span className="min-w-0 flex-1 text-sm text-ink-2">Os modelos de chatbot fazem parte do pacote Plataforma, junto com a criação de lojas pela API.</span>
          <Link href="/painel/cobranca?aba=pacotes" className="btn-primary py-1.5 text-xs">
            Assinar o pacote
          </Link>
        </div>
      ) : (templates ?? []).length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-5 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-raised text-ink-2">
            <Layers size={20} />
          </span>
          <span className="text-[15px] font-medium text-ink">Nenhum modelo ainda</span>
          <span className="max-w-[420px] text-sm text-muted">Crie um modelo com o que se repete entre os seus clientes ou lojas, e os chatbots de cada um nascem dele.</span>
          {newButton}
        </div>
      ) : (
        <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">
          {(templates ?? []).map((t) => {
            const n = count.get(t.id as string) ?? 0;
            return (
              <li key={t.id as string}>
                <Link href={`/painel/bots/${t.id}?tab=heranca`} className="group flex items-center gap-3 px-4 py-3.5 transition-colors duration-[120ms] hover:bg-raised/40">
                  <BotFace color={(t.appearance as { color?: string } | null)?.color} face={t.face} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-[15px] font-medium text-ink">{t.name as string}</span>
                      <StatusPill tone={n ? "ok" : "muted"}>
                        {n} chatbot{n === 1 ? "" : "s"} derivado{n === 1 ? "" : "s"}
                      </StatusPill>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">Alterado {relativeTime(t.updated_at as string)}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-muted transition-transform duration-[120ms] group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
