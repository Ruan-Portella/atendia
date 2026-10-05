"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Step = { kind: "carregando" } | { kind: "cadastrar"; factorId: string; qr: string; secret: string } | { kind: "verificar"; factorId: string } | { kind: "erro"; message: string };

/**
 * Segunda etapa (app autenticador, TOTP do Supabase), do backoffice e do painel. Primeira vez:
 * mostra o QR para cadastrar no app; depois, só pede o código de 6 dígitos a cada novo login.
 * onResult registra a entrada ou a falha (e o cadastro); next: para onde ir depois (download de
 * /api/… vai pelo navegador, para baixar o arquivo).
 */
export function MfaForm({ friendlyName, next, submitLabel, onResult }: { friendlyName: string; next: string; submitLabel: string; onResult: (ok: boolean, enrolled: boolean) => Promise<void> }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "carregando" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setStep({ kind: "erro", message: error.message });
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setStep({ kind: "verificar", factorId: verified.id });
      // cadastro que ficou pela metade: apaga e começa de novo (o Supabase recusa dois com o mesmo nome)
      for (const f of data.all.filter((x) => x.factor_type === "totp" && x.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName });
      if (enrollError || !enrolled) return setStep({ kind: "erro", message: enrollError?.message ?? "não foi possível cadastrar" });
      setStep({ kind: "cadastrar", factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    })();
  }, [friendlyName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "cadastrar" && step.kind !== "verificar") return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: step.factorId, code: code.trim() });
    setBusy(false);
    // registro de acesso (entrada ou falha) e, no primeiro código, o cadastro; não segura a tela
    void onResult(!error, step.kind === "cadastrar").catch(() => {});
    if (error) return setError("Código inválido ou vencido. Confira o app e tente de novo.");
    if (next.startsWith("/api/")) return window.location.assign(next);
    router.replace(next);
    router.refresh();
  }

  if (step.kind === "carregando") return <p className="text-sm text-muted">Carregando…</p>;
  if (step.kind === "erro") return <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Não deu para preparar a verificação: {step.message}</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {step.kind === "cadastrar" ? (
        <>
          <p className="text-sm text-muted">Primeiro acesso: abra o Google Authenticator, o Authy ou outro app autenticador e escaneie o código abaixo. Depois digite o código de 6 dígitos que aparece no app.</p>
          {/* QR do Supabase (SVG em data URL) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={step.qr} alt="QR code para cadastrar no app autenticador" className="h-48 w-48 self-center rounded-lg border border-line bg-white p-2" />
          <p className="text-xs text-muted">Sem câmera? Digite esta chave no app: <code className="break-all rounded bg-ground px-1.5 py-0.5 text-ink">{step.secret}</code></p>
        </>
      ) : (
        <p className="text-sm text-muted">Digite o código de 6 dígitos do seu app autenticador.</p>
      )}
      <div>
        <label htmlFor="mfa-code" className="label">Código</label>
        <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="input text-center text-lg tracking-[0.3em] tabular" autoFocus />
      </div>
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
        {busy ? "Conferindo…" : submitLabel}
      </button>
    </form>
  );
}
