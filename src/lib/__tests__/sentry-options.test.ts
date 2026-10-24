import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import type { StreamedSpanJSON } from "@sentry/core";
import { baseOptions, scrubEvent, scrubSpan } from "../sentry-options";

describe("Sentry sem dados pessoais", () => {
  it("tira usuário, corpo, cookies, cabeçalhos, query e logs do console", () => {
    const out = scrubEvent({
      type: undefined,
      user: { email: "ana@x.com", ip_address: "1.2.3.4" },
      request: { method: "POST", url: "https://boavoz.com/api/chat?visitorId=v1", data: '{"text":"meu cpf é 123"}', cookies: { sb: "x" }, headers: { authorization: "Bearer y" }, query_string: "visitorId=v1" },
      breadcrumbs: [
        { category: "console", message: "instagram: DM recebida oi tudo bem" },
        { category: "fetch", data: { url: "https://graph.facebook.com/x?access_token=segredo" } },
      ],
    } as ErrorEvent);
    expect(out.user).toBeUndefined();
    expect(out.request).toEqual({ method: "POST", url: "https://boavoz.com/api/chat" });
    expect(out.breadcrumbs).toEqual([{ category: "fetch", data: { url: "https://graph.facebook.com/x" } }]);
  });

  it("a coleta do SDK 11 fica desligada (sendDefaultPii não vale mais)", () => {
    expect(baseOptions.dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false }, databaseQueryData: false, stackFrameVariables: false });
    expect(baseOptions.beforeSendSpan).toBe(scrubSpan);
  });

  it("spans: sem o texto da IA, corpo, cabeçalho, query nem usuário; ficam o modelo e o uso", () => {
    const out = scrubSpan({
      trace_id: "t",
      span_id: "s",
      name: "GET /api/chat?visitorId=v1",
      start_timestamp: 1,
      status: "ok",
      is_segment: false,
      attributes: {
        "gen_ai.input.messages": '[{"role":"user","content":"meu cpf é 123"}]',
        "gen_ai.output.messages": "resposta",
        "gen_ai.request.model": "gpt-6-luna",
        "gen_ai.usage.input_tokens": 120,
        "ai.prompt": "oi",
        "ai.response.text": "olá",
        "ai.model.id": "gpt-6-luna",
        "http.request.body.size": 10,
        "http.request.header.cookie": "bv_d=x",
        "url.full": "https://boavoz.com/api/chat?visitorId=v1",
        "url.query": "visitorId=v1",
        "user.email": "ana@x.com",
        "db.query.text": "select * from contacts where email = 'ana@x.com'",
        "http.response.status_code": 200,
      },
    } as StreamedSpanJSON);
    expect(out.name).toBe("GET /api/chat");
    expect(out.attributes).toEqual({
      "gen_ai.request.model": "gpt-6-luna",
      "gen_ai.usage.input_tokens": 120,
      "ai.model.id": "gpt-6-luna",
      "url.full": "https://boavoz.com/api/chat",
      "http.response.status_code": 200,
    });
  });
});
