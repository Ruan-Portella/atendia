"use client";

import { useEffect, useRef, useState } from "react";

type Preview = { ok: false; message: string } | { ok: true; summary: string; expected: string; empty: boolean };

/**
 * Pedido de titular (LGPD): o e-mail ou o telefone e, ao parar de digitar, quanto vai sair. O
 * Apagar dados só vale com a prévia (relatório de segurança de 23/10/2026, M1): o servidor confere
 * que o que sai é o que a tela mostrou.
 */
export function EraseContactField({ preview }: { preview: (contact: string) => Promise<Preview> }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<(Preview & { for: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const v = value.trim();
  const ready = v.includes("@") ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) : v.replace(/\D/g, "").length >= 10;
  // a prévia só vale para o que está digitado agora
  const shown = ready && result?.for === v ? result : null;

  useEffect(() => {
    if (!ready) {
      seq.current++;
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      setLoading(true);
      preview(v)
        .then((r) => n === seq.current && setResult({ ...r, for: v }))
        .catch(() => n === seq.current && setResult({ ok: false, message: "Não foi possível conferir agora. Tente de novo.", for: v }))
        .finally(() => n === seq.current && setLoading(false));
    }, 500);
    return () => clearTimeout(t);
  }, [v, ready, preview]);

  return (
    <div className="space-y-2">
      <label htmlFor="erase-contact" className="label">
        E-mail ou WhatsApp que a pessoa deixou no chat
      </label>
      <input id="erase-contact" name="contact" required maxLength={120} className="input" placeholder="ana@exemplo.com ou (21) 99999-0000" value={value} onChange={(e) => setValue(e.target.value)} />
      <input type="hidden" name="expected" value={shown?.ok ? shown.expected : ""} />
      <p className="min-h-5 text-sm" aria-live="polite">
        {loading && ready && !shown ? (
          <span className="text-muted">Conferindo…</span>
        ) : shown ? (
          <span className={shown.ok && !shown.empty ? "font-semibold text-ink" : "text-muted"}>{shown.ok ? shown.summary : shown.message}</span>
        ) : (
          <span className="text-muted">Com o telefone, vai o DDD. Antes de apagar, aparece aqui quanto vai sair.</span>
        )}
      </p>
    </div>
  );
}
