import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestSource, type SourceRow } from "@/lib/ingest";
import { normalizeUrl } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Adiciona uma fonte ao bot e processa na hora.
 * multipart/form-data: kind=site|page|text|faq|pdf, url, title, content, file
 */
export async function POST(req: Request, ctx: RouteContext<"/api/bots/[id]/sources">) {
  const { id: botId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // RLS garante que o bot é da agência do usuário
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return Response.json({ error: "not_found" }, { status: 404 });

  const form = await req.formData();
  const kind = z.enum(["site", "page", "text", "faq", "pdf"]).parse(form.get("kind"));
  const title = String(form.get("title") ?? "").trim();
  const rawUrl = String(form.get("url") ?? "");
  const content = String(form.get("content") ?? "");
  const file = form.get("file");

  let row: Partial<SourceRow> = { bot_id: botId, kind, title };
  let pdfBuffer: ArrayBuffer | undefined;

  if (kind === "site" || kind === "page") {
    const url = normalizeUrl(rawUrl);
    if (!url) return Response.json({ error: "invalid_url", message: "URL inválida." }, { status: 400 });
    row = { ...row, url, title: title || new URL(url).hostname.replace(/^www\./, "") };
  } else if (kind === "pdf") {
    if (!(file instanceof File)) return Response.json({ error: "no_file", message: "Envie um PDF." }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return Response.json({ error: "too_large", message: "PDF acima de 15 MB." }, { status: 400 });
    pdfBuffer = await file.arrayBuffer();
    row = { ...row, title: title || file.name };
    const admin = createAdminClient();
    await admin.storage.from("sources").upload(`${botId}/${Date.now()}-${file.name}`, pdfBuffer, { contentType: "application/pdf", upsert: false });
  } else {
    if (content.trim().length < 20) return Response.json({ error: "empty", message: "Escreva pelo menos algumas linhas." }, { status: 400 });
    row = { ...row, content, title: title || (kind === "faq" ? "Perguntas frequentes" : "Texto") };
  }

  const admin = createAdminClient();
  const { data: source, error } = await admin.from("sources").insert(row).select("id, bot_id, kind, title, url, content").single();
  if (error || !source) return Response.json({ error: "insert_failed", message: error?.message }, { status: 500 });

  try {
    const r = await ingestSource(admin, source as SourceRow, pdfBuffer);
    return Response.json({ ok: true, sourceId: source.id, ...r });
  } catch (e) {
    return Response.json({ error: "ingest_failed", message: (e as Error).message, sourceId: source.id }, { status: 422 });
  }
}

/** Remove uma fonte (e seus trechos, por cascade). ?sourceId= */
export async function DELETE(req: Request, ctx: RouteContext<"/api/bots/[id]/sources">) {
  const { id: botId } = await ctx.params;
  const sourceId = new URL(req.url).searchParams.get("sourceId");
  if (!sourceId) return Response.json({ error: "missing_source", message: "Fonte não informada." }, { status: 400 });
  const supabase = await createClient();
  const { error, count } = await supabase.from("sources").delete({ count: "exact" }).eq("id", sourceId).eq("bot_id", botId);
  if (error) return Response.json({ error: error.message, message: "Não foi possível remover a fonte." }, { status: 500 });
  if (!count) return Response.json({ error: "not_found", message: "Fonte não encontrada." }, { status: 404 });
  return Response.json({ ok: true });
}

/**
 * Atualiza e/ou reprocessa uma fonte. ?sourceId=
 * - Sem corpo: só reprocessa (relê o site/página, regera embeddings).
 * - multipart/form-data com title/url/content/file: aplica as mudanças e reprocessa.
 *   Se só o título mudou, não reprocessa (não gasta embeddings à toa).
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/bots/[id]/sources">) {
  const { id: botId } = await ctx.params;
  const sourceId = new URL(req.url).searchParams.get("sourceId");
  const supabase = await createClient();
  const { data: source } = await supabase.from("sources").select("id, bot_id, kind, title, url, content").eq("id", sourceId ?? "").eq("bot_id", botId).maybeSingle();
  if (!source) return Response.json({ error: "not_found", message: "Fonte não encontrada." }, { status: 404 });

  const patch: Partial<SourceRow> = {};
  let pdfBuffer: ArrayBuffer | undefined;

  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const title = String(form.get("title") ?? "").trim();
    if (title && title !== source.title) patch.title = title.slice(0, 120);

    if (form.has("url")) {
      const url = normalizeUrl(String(form.get("url")));
      if (!url) return Response.json({ error: "invalid_url", message: "URL inválida." }, { status: 400 });
      if (url !== source.url) patch.url = url;
    }
    if (form.has("content")) {
      const content = String(form.get("content"));
      if (content.trim().length < 20) return Response.json({ error: "empty", message: "Escreva pelo menos algumas linhas." }, { status: 400 });
      if (content !== source.content) patch.content = content;
    }
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (source.kind !== "pdf") return Response.json({ error: "not_pdf", message: "Só fontes do tipo PDF aceitam arquivo." }, { status: 400 });
      if (file.size > 15 * 1024 * 1024) return Response.json({ error: "too_large", message: "PDF acima de 15 MB." }, { status: 400 });
      pdfBuffer = await file.arrayBuffer();
      if (!title) patch.title = file.name;
      await createAdminClient().storage.from("sources").upload(`${botId}/${Date.now()}-${file.name}`, pdfBuffer, { contentType: "application/pdf", upsert: false });
    }
  }

  const admin = createAdminClient();
  const changedKeys = Object.keys(patch);
  if (changedKeys.length) {
    const { error } = await admin.from("sources").update(patch).eq("id", source.id);
    if (error) return Response.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // Só renomeou: não precisa reler nada.
  const onlyTitle = changedKeys.length > 0 && changedKeys.every((k) => k === "title") && !pdfBuffer;
  if (onlyTitle) return Response.json({ ok: true, renamed: true });

  if (source.kind === "pdf" && !pdfBuffer) {
    return Response.json({ error: "pdf_reupload", message: "Para atualizar o conteúdo de um PDF, envie o arquivo de novo." }, { status: 400 });
  }

  try {
    const r = await ingestSource(admin, { ...(source as SourceRow), ...patch }, pdfBuffer);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ error: "ingest_failed", message: (e as Error).message }, { status: 422 });
  }
}
