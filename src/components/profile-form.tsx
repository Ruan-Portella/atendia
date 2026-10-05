"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";

/**
 * Meu perfil (leva B1'): nome de exibição e foto, com a prévia de como o contato vê no WhatsApp
 * (o anúncio de entrada no começo da primeira mensagem) e no chat do site (nome e foto em cada
 * mensagem). A foto vai para o Storage público (o contato vê no widget).
 */
export function ProfileForm({ action, folder, name, avatar, entryExample, company }: {
  action: (fd: FormData) => Promise<ActionResult>;
  /** pasta da foto no Storage: avatars/<id da pessoa> */
  folder: string;
  name: string;
  avatar: string | null;
  /** anúncio de entrada com {atendente} ainda por trocar */
  entryExample: string;
  company: string;
}) {
  const [value, setValue] = useState(name);
  const [url, setUrl] = useState(avatar ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const shown = value.trim() || "Seu nome";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast.error("Use uma foto PNG, JPG ou WEBP.");
    if (file.size > 1024 * 1024) return toast.error("Foto acima de 1 MB. Use uma menor.");
    setBusy(true);
    const supabase = createClient();
    const path = `avatars/${folder}/${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: false, contentType: file.type });
    if (error) toast.error(`Não foi possível enviar a foto: ${error.message}`);
    else {
      setUrl(supabase.storage.from("logos").getPublicUrl(path).data.publicUrl);
      toast.success("Foto enviada. Clique em Salvar para aplicar.");
    }
    setBusy(false);
  }

  return (
    <ActionForm action={action} success="Perfil salvo." className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-bold">Como os contatos veem você</h2>
        <p className="text-sm text-muted">Quando você atende uma conversa, o contato vê este nome (e a foto, no chat do site). Use o primeiro nome ou como a equipe chama você.</p>
      </div>
      <div>
        <label htmlFor="display_name" className="label">Nome de exibição</label>
        <input id="display_name" name="display_name" required maxLength={40} value={value} onChange={(e) => setValue(e.target.value)} className="input max-w-[320px]" />
      </div>
      <div>
        <label htmlFor="avatar_file" className="label">Foto (opcional, até 1 MB)</label>
        <div className="flex flex-wrap items-center gap-3">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-base font-bold text-brand">{shown.charAt(0).toUpperCase()}</span>
          )}
          <input id="avatar_file" type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} disabled={busy} className="input max-w-[320px]" />
          {url && <button type="button" onClick={() => setUrl("")} className="text-xs font-semibold text-muted hover:underline">Tirar a foto</button>}
        </div>
        <input type="hidden" name="avatar_url" value={url} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-ground p-3 text-sm">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">WhatsApp e Instagram</div>
          <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
            <span className="text-muted">{entryExample.replaceAll("{atendente}", shown).replaceAll("{empresa}", company)}</span>
            {"\n"}
            <span className="block pt-1.5">Já vi aqui o seu pedido, só um instante.</span>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">O anúncio vai só na sua primeira mensagem depois de assumir.</p>
        </div>
        <div className="rounded-lg bg-ground p-3 text-sm">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Chat do site</div>
          <div className="flex items-end gap-2">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#cfe3d8] text-[11px] font-bold text-[#1f4e3d]">{shown.charAt(0).toUpperCase()}</span>
            )}
            <div className="rounded-[14px_14px_14px_4px] border border-[#cfe3d8] bg-[#eef6f1] px-3 py-2">
              <div className="text-[11px] font-semibold text-[#1f4e3d]">{shown}</div>
              Já vi aqui o seu pedido, só um instante.
            </div>
          </div>
        </div>
      </div>
      <SubmitButton pendingLabel="Salvando…" className="btn-primary self-start" disabled={busy}>Salvar</SubmitButton>
    </ActionForm>
  );
}
