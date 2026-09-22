"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/painel";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agency, setAgency] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const supabase = createClient();

  async function google() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setMsg({ kind: "err", text: error.message });
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMsg({ kind: "err", text: error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message });
        setBusy(false);
        return;
      }
      router.push(next);
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { agency_name: agency }, emailRedirectTo: `${location.origin}/auth/callback?next=/painel` },
      });
      if (error) {
        setMsg({ kind: "err", text: error.message });
        setBusy(false);
        return;
      }
      if (data.session) {
        router.push("/painel");
        router.refresh();
      } else {
        setMsg({ kind: "ok", text: "Conta criada. Confira seu e-mail para confirmar e entrar." });
        setBusy(false);
      }
    }
  }

  return (
    <div className="card w-full max-w-[420px] p-7">
      <h1 className="text-2xl font-bold">{mode === "login" ? "Entrar" : "Criar conta grátis"}</h1>
      <p className="mt-1 text-sm text-muted">{mode === "login" ? "Bem-vindo de volta." : "14 dias de teste, sem cartão."}</p>

      <button type="button" onClick={google} disabled={busy} className="btn-ghost mt-6 w-full">
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" /></svg>
        Continuar com Google
      </button>
      <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === "signup" && (
          <div>
            <label htmlFor="agency" className="label">Nome da agência (ou o seu)</label>
            <input id="agency" required value={agency} onChange={(e) => setAgency(e.target.value)} className="input" placeholder="Norte Marketing" />
          </div>
        )}
        <div>
          <label htmlFor="email" className="label">E-mail</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="password" className="label">Senha</label>
          <input id="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
        </div>
        {msg && <div className={msg.kind === "ok" ? "rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand" : "rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"}>{msg.text}</div>}
        <button type="submit" disabled={busy} className="btn-primary w-full py-3">{busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}</button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        {mode === "login" ? (
          <>Ainda não tem conta? <Link href="/cadastro" className="font-semibold text-brand">Criar grátis</Link></>
        ) : (
          <>Já tem conta? <Link href="/login" className="font-semibold text-brand">Entrar</Link></>
        )}
      </p>
    </div>
  );
}
