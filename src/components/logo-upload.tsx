"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LogoUpload({ current, agencyId }: { current: string | null; agencyId: string }) {
  const [url, setUrl] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const supabase = createClient();
    const path = `${agencyId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (!error) setUrl(supabase.storage.from("logos").getPublicUrl(path).data.publicUrl);
    setBusy(false);
  }
  return (
    <div>
      <label htmlFor="logo_file" className="label">Logo (PNG ou SVG, fundo transparente)</label>
      <div className="flex items-center gap-3">
        {url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt="" className="h-10 w-10 rounded-lg object-contain" /> : <span className="h-10 w-10 rounded-lg bg-ground" />}
        <input id="logo_file" type="file" accept="image/*" onChange={onFile} disabled={busy} className="input" />
      </div>
      <input type="hidden" name="logo_url" value={url} />
    </div>
  );
}
