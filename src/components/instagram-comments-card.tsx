import type { CommentItem } from "@/lib/instagram-comments";
import { relativeTime } from "@/lib/utils";

/*
 * Comentários dos posts na aba Instagram (E1, parte 4a): cada comentário que chegou e o que o
 * BoaVoz fez (a resposta privada no direct, a pública, ou nada, com o motivo). Sem a permissão dos
 * comentários da Meta, o cartão só explica o que vem.
 */

const ACTION_LABEL: Record<CommentItem["action"], string> = {
  privada: "resposta no direct",
  publica: "resposta pública",
  privada_publica: "resposta no direct e pública",
  nenhuma: "sem resposta",
  ignorado: "ignorado",
  erro: "não foi respondido",
};

export function InstagramCommentsCard({ enabled, comments, posts }: { enabled: boolean; comments: CommentItem[]; posts: Record<string, { caption: string | null; posted_at: string }> }) {
  if (!enabled) {
    return (
      <div className="card flex flex-col gap-1.5 p-5">
        <div className="font-semibold">Comentários dos posts</div>
        <p className="text-sm text-muted">Responder comentários (a resposta privada no direct para quem comentou e a resposta pública no post) depende de uma permissão da Meta que pede uma revisão própria. Chega aqui assim que a Meta aprovar.</p>
      </div>
    );
  }
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div>
        <div className="font-semibold">Comentários dos posts</div>
        <p className="text-sm text-muted">
          Os comentários que chegaram e o que o assistente fez. A palavra-chave no comentário manda a resposta privada no direct (uma por comentário, até 7 dias depois dele; para quem não segue a conta, ela cai em <strong>Solicitações de mensagem</strong>) e, se você quiser, uma resposta pública. Se a conta foi conectada antes, conecte o Instagram de novo para dar a permissão dos comentários.
        </p>
      </div>
      {comments.length === 0 ? (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-muted">Nenhum comentário ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-2 rounded-xl border border-line">
          {comments.map((c) => {
            const post = c.mediaId ? posts[c.mediaId] : undefined;
            return (
              <li key={c.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span className="font-semibold text-ink">{c.username ? `@${c.username}` : "alguém"}</span>
                  <span>{relativeTime(c.createdAt)}</span>
                  {post && <span className="truncate">no post de {new Date(post.posted_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}{post.caption ? `: ${post.caption.trim().slice(0, 50)}` : ""}</span>}
                  <span className={`ml-auto rounded-full px-2 py-0.5 font-semibold ${c.action === "erro" ? "bg-danger-soft text-danger" : c.action === "nenhuma" || c.action === "ignorado" ? "bg-ground" : "bg-brand-soft text-brand"}`}>{ACTION_LABEL[c.action]}</span>
                </div>
                <p className="text-ink-2">“{c.text ?? "(sem texto)"}”</p>
                {c.reason && <p className="text-xs text-muted">Motivo: {c.reason}</p>}
                {c.privateReply && <p className="text-xs text-ink-2">No direct: {c.privateReply}</p>}
                {c.publicReply && <p className="text-xs text-ink-2">Em público: {c.publicReply}</p>}
                {c.error && <p className="text-xs text-danger">{c.error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
