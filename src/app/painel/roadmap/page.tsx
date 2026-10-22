import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROADMAP_TITLE_MAX, SUGGESTION_DETAILS_MAX, SUGGESTION_STATUS_LABEL, likedBy, loadRoadmap, suggestionsOf } from "@/lib/roadmap";
import { RoadmapBoard } from "@/components/roadmap/roadmap-board";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { sendRoadmapSuggestion, toggleRoadmapLike } from "./actions";

export const metadata = { title: "Roadmap" };

/** Roadmap no painel (Lançamento, parte 5): curtir e mandar ideias, para qualquer papel da equipe. */
export default async function PanelRoadmapPage() {
  const { userId } = await requireAgency();
  const db = createAdminClient();
  const [items, liked, mine] = await Promise.all([loadRoadmap(db), likedBy(db, userId), suggestionsOf(db, userId)]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-normal sm:text-[28px]">Roadmap</h1>
        <p className="max-w-[720px] text-sm text-muted">
          O que estamos fazendo e o que vem por aí, sem datas: a ordem muda com o que os clientes pedem. Curta o que você mais quer (uma curtida por pessoa) e mande ideias. A mesma página fica aberta, sem login, em{" "}
          <Link href="/roadmap" className="font-medium text-brand underline">boavoz.com/roadmap</Link>.
        </p>
      </div>

      <RoadmapBoard items={items} liked={liked} like={toggleRoadmapLike} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-medium">Mande uma ideia</h2>
            <p className="text-sm text-muted">A gente lê todas. As que entram aparecem em Ideias, já com a sua curtida; se já existe uma parecida, juntamos as duas.</p>
          </div>
          <ActionForm action={sendRoadmapSuggestion} className="flex flex-col gap-3">
            <div>
              <label htmlFor="roadmap-title" className="label">O que você quer que o BoaVoz faça?</label>
              <input id="roadmap-title" name="title" required minLength={3} maxLength={ROADMAP_TITLE_MAX} className="input" />
            </div>
            <div>
              <label htmlFor="roadmap-details" className="label">Detalhes (opcional): para que serve, como você faz hoje</label>
              <textarea id="roadmap-details" name="details" rows={4} maxLength={SUGGESTION_DETAILS_MAX} className="input" />
            </div>
            <SubmitButton className="btn-primary self-start" pendingLabel="Mandando…">Mandar ideia</SubmitButton>
          </ActionForm>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Suas ideias</h2>
          {mine.length === 0 ? (
            <p className="text-sm text-muted">Você ainda não mandou nenhuma ideia.</p>
          ) : (
            <ul className="card flex flex-col">
              {mine.map((s) => (
                <li key={s.id} className="flex flex-col gap-0.5 border-b border-line-2 px-4 py-3 text-sm last:border-0">
                  <span className="font-semibold">{s.title}</span>
                  <span className="text-xs text-muted">
                    {SUGGESTION_STATUS_LABEL[s.status]}
                    {s.status === "juntada" && s.itemTitle ? `: “${s.itemTitle}”` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
