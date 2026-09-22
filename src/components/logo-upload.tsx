"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

export function LogoUpload({ current, agencyId }: { current: string | null; agencyId: string }) {
  const [url, setUrl] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
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
    else {
      setUrl(supabase.storage.from("logos").getPublicUrl(path).data.publicUrl);
      toast.success("Logo enviado. Clique em Salvar para aplicar.");
    }
    setBusy(false);
  }
  return (
    <div>
      <label htmlFor="logo_file" className="label">Logo (PNG ou SVG, fundo transparente)</label>
      <div className="flex items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-10 w-10 rounded-lg object-contain" />
        ) : (
          <span className="h-10 w-10 rounded-lg bg-ground" />
        )}
        <input id="logo_file" type="file" accept="image/*" onChange={onFile} disabled={busy} className="input" />
      </div>
      <input type="hidden" name="logo_url" value={url} />
    </div>
  );
}
