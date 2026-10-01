import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "../sentry-options";

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
});
