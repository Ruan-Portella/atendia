import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newDeletionCode, parseSignedRequest } from "../deletions";

/** signed_request como a Meta monta: base64url(HMAC-SHA256(dados)) + "." + base64url(dados). */
function sign(data: object, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${sig}.${payload}`;
}

const secrets = [
  { app: "instagram", secret: "segredo-ig" },
  { app: "facebook", secret: "segredo-fb" },
];

describe("signed_request da Meta", () => {
  it("lê o user_id e diz qual app assinou", () => {
    const ig = parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "17841400000000000", issued_at: 1 }, "segredo-ig"), secrets);
    expect(ig).toEqual({ app: "instagram", data: { algorithm: "HMAC-SHA256", user_id: "17841400000000000", issued_at: 1 } });
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: 123 }, "segredo-fb"), secrets)?.app).toBe("facebook");
  });

  it("recusa assinatura de outra chave, adulterada, sem user_id ou malformada", () => {
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "outra"), secrets)).toBeNull();
    const ok = sign({ algorithm: "HMAC-SHA256", user_id: "1" }, "segredo-ig");
    const forged = `${ok.split(".")[0]}.${Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "2" })).toString("base64url")}`;
    expect(parseSignedRequest(forged, secrets)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "HMAC-SHA256" }, "segredo-ig"), secrets)).toBeNull();
    expect(parseSignedRequest("sem-ponto", secrets)).toBeNull();
    expect(parseSignedRequest(null, secrets)).toBeNull();
  });

  it("código de confirmação curto, sem dado pessoal, diferente a cada pedido", () => {
    const a = newDeletionCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(newDeletionCode()).not.toBe(a);
  });
});
