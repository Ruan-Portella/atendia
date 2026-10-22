"use client";

import { useState } from "react";
import { ImagePlus, MessageCircle, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/*
 * Os campos de Marca e domínio que pedem mais que um input (redesenho, etapa 5): o logo com a prévia
 * e o enviar, trocar e tirar; a cor com a prévia do chat; o prazo de guarda em cartões.
 */

/** O logo: envia para o armazenamento na hora; o Salvar do modal aplica (campo logo_url). */
export function LogoField({ current, agencyId }: { current: string | null; agencyId: string }) {
  const [url, setUrl] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo acima de 2 MB. Use um PNG ou SVG menor.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const path = `${agencyId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (error) toast.error(`Não foi possível enviar o logo: ${error.message}`);
    else setUrl(supabase.storage.from("logos").getPublicUrl(path).data.publicUrl);
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-line bg-[repeating-conic-gradient(var(--color-raised)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Logo" className="max-h-16 max-w-16 object-contain" />
        ) : (
          <ImagePlus size={22} className="text-muted" />
        )}
      </span>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <label className={cn("btn-ghost cursor-pointer", busy && "pointer-events-none opacity-60")}>
            {busy ? "Enviando…" : url ? "Trocar o logo" : "Enviar o logo"}
            <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" onChange={onFile} disabled={busy} className="sr-only" />
          </label>
          {url && (
            <button type="button" onClick={() => setUrl("")} className="btn-ghost text-danger">
              <Trash2 size={15} /> Tirar
            </button>
          )}
        </div>
        <p className="text-xs text-muted">PNG ou SVG com fundo transparente, até 2 MB.</p>
      </div>
      <input type="hidden" name="logo_url" value={url} />
    </div>
  );
}

const SWATCHES = ["#1F8A5B", "#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#0F172A"];

/** A cor, com sugestões e a prévia do botão e do balão do chat. */
export function ColorField({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [color, setColor] = useState(defaultValue);
  const [hex, setHex] = useState(defaultValue.toUpperCase());
  const pick = (c: string) => {
    setColor(c);
    setHex(c.toUpperCase());
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="color" name={name} aria-label="Cor" value={color} onChange={(e) => pick(e.target.value)} className="h-10 w-14 cursor-pointer rounded-[10px] border border-line-strong bg-field p-1" />
        <input
          aria-label="Código da cor"
          value={hex}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.trim();
            setHex(v.toUpperCase());
            if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v.toLowerCase());
          }}
          onBlur={() => setHex(color.toUpperCase())}
          className="input w-[110px] font-mono text-[13px] uppercase"
        />
        <div className="flex gap-1.5" role="group" aria-label="Sugestões">
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={`Usar ${c}`} aria-pressed={color.toLowerCase() === c.toLowerCase()} onClick={() => pick(c.toLowerCase())} className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-panel transition-shadow duration-[120ms]", color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-line-strong")} style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="flex items-end justify-end gap-2.5 rounded-[14px] bg-ground p-4" aria-hidden>
        <span className="max-w-[220px] rounded-[14px] rounded-br-sm px-3 py-2 text-[13px] text-white" style={{ background: color }}>
          Oi! Quero saber o horário de vocês.
        </span>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-[0_4px_12px_rgb(0_0_0/0.18)]" style={{ background: color }}>
          <MessageCircle size={20} />
        </span>
      </div>
    </div>
  );
}

/** O prazo de guarda em cartões (6, 12 ou 24 meses). */
export function RetentionField({ name, value, options }: { name: string; value: number; options: readonly number[] }) {
  const [on, setOn] = useState(value);
  const hint: Record<number, string> = { 6: "O mínimo: só o recente", 12: "O padrão", 24: "Para quem volta pouco" };
  return (
    <div role="radiogroup" aria-label="Guardar por" className="grid gap-2 sm:grid-cols-3">
      {options.map((m) => (
        <label key={m} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-[14px] border p-3 transition-colors duration-[120ms]", on === m ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong")}>
          <input type="radio" name={name} value={m} checked={on === m} onChange={() => setOn(m)} className="sr-only" />
          <span className="text-sm font-medium text-ink">{m} meses</span>
          {hint[m] && <span className="text-xs text-muted">{hint[m]}</span>}
        </label>
      ))}
    </div>
  );
}
