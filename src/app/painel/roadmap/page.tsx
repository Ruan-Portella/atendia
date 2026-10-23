import Link from "next/link";
import { Lightbulb, ListChecks } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROADMAP_TITLE_MAX, SUGGESTION_DETAILS_MAX, SUGGESTION_STATUS_LABEL, likedBy, loadRoadmap, suggestionsOf } from "@/lib/roadmap";
import { RoadmapBoard } from "@/components/roadmap/roadmap-board";
import { DialogButton } from "@/components/ui/setting-row";
import { sendRoadmapSuggestion, toggleRoadmapLike } from "./actions";

export const metadata = { title: "Roadmap" };

/**
 * Roadmap no painel (Lançamento, parte 5): curtir e mandar ideias, para qualquer papel da equipe.
 * Redesenho (23/10/2026, a pedido do usuário): "Mandar ideia" e "Suas ideias" em modais no alto, e o
 * quadro com as colunas em abas no celular e no tablet.
 */
export default async function PanelRoadmapPage() {
  const { userId } = await requireAgency();
  const db = createAdminClient();
  const [items, liked, mine] = await Promise.all([loadRoadmap(db), likedBy(db, userId), suggestionsOf(db, userId)]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-normal sm:text-[28px]">Roadmap</h1>
          <p className="max-w-[640px] text-sm text-muted">
            O que estamos fazendo e o que vem por aí, sem datas: a ordem muda com o que os clientes pedem. Curta o que você mais quer (uma curtida por pessoa) e mande ideias. A mesma página fica aberta, sem login, em{" "}
            <Link href="/roadmap" className="font-medium text-brand underline">
              boavoz.com/roadmap
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DialogButton label={`Suas ideias · ${mine.length}`} icon={<ListChecks size={15} />} className="btn-ghost" title="Suas ideias" description="O que você mandou e o que aconteceu com cada uma." footer="close">
            {mine.length === 0 ? (
              <p className="text-sm text-muted">Você ainda não mandou nenhuma ideia.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-2 overflow-hidden rounded-[14px] border border-line">
                {mine.map((s) => (
                  <li key={s.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                    <span className="font-medium text-ink">{s.title}</span>
                    <span className="text-xs text-muted">
                      {SUGGESTION_STATUS_LABEL[s.status]}
                      {s.status === "juntada" && s.itemTitle ? `: “${s.itemTitle}”` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DialogButton>
          <DialogButton label="Mandar ideia" icon={<Lightbulb size={15} />} className="btn-primary" title="Mande uma ideia" description="A gente lê todas. As que entram aparecem em Ideias, já com a sua curtida; se já existe uma parecida, juntamos as duas." action={sendRoadmapSuggestion} saveLabel="Mandar ideia">
            <div>
              <label htmlFor="roadmap-title" className="label">
                O que você quer que o BoaVoz faça?
              </label>
              <input id="roadmap-title" name="title" required minLength={3} maxLength={ROADMAP_TITLE_MAX} className="input" />
            </div>
            <div>
              <label htmlFor="roadmap-details" className="label">
                Detalhes (opcional): para que serve, como você faz hoje
              </label>
              <textarea id="roadmap-details" name="details" rows={4} maxLength={SUGGESTION_DETAILS_MAX} className="input" />
            </div>
          </DialogButton>
        </div>
      </div>

      <RoadmapBoard items={items} liked={[...liked]} like={toggleRoadmapLike} />
    </div>
  );
}
