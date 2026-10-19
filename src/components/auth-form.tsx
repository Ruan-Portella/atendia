"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeLocalPath } from "@/lib/utils";
import { sendLoginCode, verifyLoginCode } from "@/app/login/actions";

/** Segundos até poder pedir outro código (o servidor também segura). */
const RESEND_SECONDS = 45;

/**
 * Entrar e criar conta numa tela só (Entrada e docs, parte 3): o Google, ou um código que chega no
 * e-mail, sem senha. E-mail novo vira conta; o nome da agência fica para o primeiro acesso. Quem
 * chega pelo link do convite volta para ele. Sem o envio de e-mail no ambiente, só o Google.
 */
export function AuthForm({ mode, emailEnabled }: { mode: "login" | "signup"; emailEnabled: boolean }) {
  const params = useSearchParams();
  // só caminhos deste site; quem chega pelo link do convite volta para ele (sem criar agência)
  const next = safeLocalPath(params.get("next"), "/painel/clientes");
  const invited = next.startsWith("/convite/");
  const [email, setEmail] = useState(invited ? (params.get("email") ?? "") : "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [wait, setWait] = useState(0);
  // quem entrava com senha: a sessão antiga saiu (proxy) e o aviso explica o jeito novo
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(params.get("senha") === "1" ? { kind: "ok", text: "O BoaVoz agora entra sem senha: receba um código no e-mail ou use o Google." } : null);
  const [pending, start] = useTransition();
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function google() {
    setGoogleBusy(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setMsg({ kind: "err", text: error.message });
      setGoogleBusy(false);
    }
  }

  function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("email", email);
      const r = await sendLoginCode(fd);
      if (!r.ok) return setMsg({ kind: "err", text: r.message });
      setCode("");
      setWait(RESEND_SECONDS);
      if (step === "code") setMsg({ kind: "ok", text: "Mandamos um código novo. Use o do último e-mail." });
      setStep("code");
    });
  }

  function verify(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("code", code);
      fd.set("next", next);
      // deu certo: a action abre a sessão e redireciona (não volta aqui)
      const r = await verifyLoginCode(fd);
      if (r && !r.ok) setMsg({ kind: "err", text: r.message });
    });
  }

  const title = mode === "login" ? "Entrar" : "Criar conta grátis";
  const subtitle = invited ? "Use o e-mail que recebeu o convite." : mode === "login" ? "Bem-vindo de volta. Sem senha: mandamos um código para o seu e-mail." : "Monte e teste grátis, sem cartão. Sem senha: mandamos um código para o seu e-mail.";

  return (
    <div className="card w-full max-w-[420px] p-7">
      <h1 className="text-2xl font-bold">{step === "code" ? "Confira o seu e-mail" : title}</h1>
      <p className="mt-1 text-sm text-muted">
        {step === "code" ? (
          <>
            Mandamos um código para <strong className="text-ink">{email}</strong>. Ele chega em instantes; confira também o spam.
          </>
        ) : (
          subtitle
        )}
      </p>

      {step === "email" && (
        <>
          <button type="button" onClick={google} disabled={googleBusy || pending} className="btn-ghost mt-6 w-full">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" /></svg>
            Continuar com Google
          </button>
          <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
          {emailEnabled ? (
            <form onSubmit={sendCode} className="flex flex-col gap-4">
              <div>
                <label htmlFor="email" className="label">E-mail</label>
                <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
              </div>
              {msg && <Message msg={msg} />}
              <button type="submit" disabled={pending} className="btn-primary w-full py-3">{pending ? "Mandando…" : "Receber código"}</button>
            </form>
          ) : (
            <>
              {msg && <Message msg={msg} />}
              <p className="rounded-lg bg-ground px-3 py-2 text-sm text-muted">Neste ambiente, o código por e-mail ainda não está ligado: entre com o Google.</p>
            </>
          )}
        </>
      )}

      {step === "code" && (
        <form onSubmit={verify} className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="code" className="label">Código</label>
            <input
              id="code"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              maxLength={10}
              value={code}
              // colado com espaço ou hífen ("123 456"): fica só com os números
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="input text-center font-mono text-xl tracking-[0.3em]"
            />
          </div>
          {msg && <Message msg={msg} />}
          <button type="submit" disabled={pending} className="btn-primary w-full py-3">{pending ? "Conferindo…" : "Entrar"}</button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button type="button" onClick={() => sendCode()} disabled={pending || wait > 0} className="font-semibold text-brand disabled:font-normal disabled:text-muted">
              {wait > 0 ? `Reenviar em ${wait} s` : "Reenviar código"}
            </button>
            <button type="button" onClick={() => { setStep("email"); setMsg(null); }} className="text-muted hover:text-ink">
              Trocar e-mail
            </button>
          </div>
        </form>
      )}

      <p className="mt-5 text-center text-xs text-muted">
        Ao continuar, você aceita os <Link href="/termos" className="underline">Termos de uso</Link> e a <Link href="/privacidade" className="underline">Política de privacidade</Link>.
      </p>
      {step === "email" && (
        <p className="mt-3 text-center text-sm text-muted">
          {mode === "login" ? (
            <>Ainda não tem conta? <Link href={invited ? `/cadastro?next=${encodeURIComponent(next)}` : "/cadastro"} className="font-semibold text-brand">{invited ? "Criar conta" : "Criar grátis"}</Link></>
          ) : (
            <>Já tem conta? <Link href={invited ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-semibold text-brand">Entrar</Link></>
          )}
        </p>
      )}
    </div>
  );
}

function Message({ msg }: { msg: { kind: "ok" | "err"; text: string } }) {
  return <div className={msg.kind === "ok" ? "rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand" : "rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"}>{msg.text}</div>;
}
