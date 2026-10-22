import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MfaReset } from "@/components/mfa-reset";
import { StatusPill } from "@/components/ui/form-section";
import { recordMfaRemoved } from "@/app/painel/actions";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

const PANEL_TEXT = "Código do app autenticador (Google Authenticator, Authy, 1Password…), pedido uma vez por sessão em: Segurança, exportação de dados (conversas, contatos, leads e auditoria) e conversas de chatbot em modo dados sensíveis. O resto do painel não pede o código.";

/**
 * Segundo fator: o app autenticador cadastrado e onde ele é pedido (painel; o portal passa os seus).
 * Redesenho, etapa 5: o app numa linha, com a situação e o trocar.
 */
export async function MfaSection({ onRemoved = recordMfaRemoved, verifyHref = `/painel/verificar?next=${encodeURIComponent("/painel/perfil")}`, text = PANEL_TEXT, enrollHref, bare = false }: { onRemoved?: () => Promise<void>; verifyHref?: string; text?: string; enrollHref?: string; /** sem o título (na aba Segundo fator da Segurança, a aba já diz) */ bare?: boolean } = {}) {
  const { data } = await (await createClient()).auth.mfa.listFactors();
  const factors = (data?.totp ?? []).filter((f) => f.status === "verified");
  return (
    // no Meu perfil, um cartão como os outros; na aba da Segurança, solto, com a linha num cartão
    <section className={bare ? "flex flex-col gap-3" : "card flex flex-col gap-4 p-6"}>
      <div>
        {!bare && <h2 className="text-base font-medium">Segundo fator</h2>}
        <p className="text-sm text-muted">{text}</p>
      </div>
      <div className={cn("flex flex-col divide-y divide-line-2 overflow-hidden", bare ? "card" : "rounded-[14px] border border-line")}>
        {factors.length ? (
          factors.map((f, i) => (
            <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
                <KeyRound size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[15px] font-medium text-ink">{f.friendly_name || "App autenticador"}</span>
                  <StatusPill tone="ok">Ativo</StatusPill>
                </span>
                <span className="mt-0.5 block text-[12.5px] text-muted">Cadastrado em {when(f.created_at)}</span>
              </span>
              {i === 0 && <MfaReset factorIds={factors.map((x) => x.id)} onRemoved={onRemoved} verifyHref={verifyHref} />}
            </div>
          ))
        ) : (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
              <KeyRound size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[15px] font-medium text-ink">App autenticador</span>
                <StatusPill tone="warn">Não cadastrado</StatusPill>
              </span>
              <span className="mt-0.5 block text-[12.5px] text-muted">Ele é pedido na primeira vez que uma dessas partes abrir.</span>
            </span>
            {enrollHref && (
              <a href={enrollHref} className="btn-primary py-1.5 text-xs">
                Cadastrar agora
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
