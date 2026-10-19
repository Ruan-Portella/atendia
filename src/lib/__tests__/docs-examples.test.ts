import { describe, expect, it } from "vitest";
import { curlOf, examplesFor, exampleUrl, fetchOf, responseOf, type DocExample } from "../docs-examples";
import data from "../api-exemplos.json";

const sample: DocExample = {
  page: "t",
  id: "t",
  title: "t",
  method: "POST",
  path: "messages",
  query: [],
  headers: { "Idempotency-Key": "abc" },
  body: { bot_id: "bot_1", text: "Oi, d'Ávila", "x-y": 1 },
  status: 201,
  response: { status: "sent" },
  binary: false,
};

const NEXT_LINE = " \\\n";

describe("exemplos da documentação", () => {
  it("saem da mesma fonte do Postman, sem variável sobrando", () => {
    const all = data.exemplos as DocExample[];
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const ex of all) expect(JSON.stringify([ex.path, ex.query, ex.headers, ex.body]), `${ex.page}/${ex.id}`).not.toMatch(/\{\{/);
    expect(() => examplesFor("mensagens", ["nao-existe"])).toThrow(/gerar_colecao/);
  });

  it("cURL: chave pela variável, cabeçalhos e corpo com a aspa simples escapada", () => {
    const c = curlOf(sample);
    expect(c.split(NEXT_LINE)[0]).toBe('curl -X POST "https://boavoz.com/api/v1/messages"');
    expect(c).toContain('-H "Authorization: Bearer $BOAVOZ_API_KEY"');
    expect(c).toContain('-H "Idempotency-Key: abc"');
    expect(c).toContain(`"text": "Oi, d'\\''Ávila"`);
  });

  it("GET com query e JavaScript com fetch", () => {
    const get: DocExample = { ...sample, method: "GET", path: "conversations", query: [["limit", "20"], ["contact", "phone:5511"]], headers: {}, body: null };
    expect(exampleUrl(get)).toBe("https://boavoz.com/api/v1/conversations?limit=20&contact=phone%3A5511");
    expect(curlOf(get)).toBe(`curl "https://boavoz.com/api/v1/conversations?limit=20&contact=phone%3A5511"${NEXT_LINE}  -H "Authorization: Bearer $BOAVOZ_API_KEY"`);
    const js = fetchOf(sample);
    expect(js).toContain('method: "POST",');
    expect(js).toContain('bot_id: "bot_1",');
    expect(js).toContain('"x-y": 1');
    expect(js).toContain("const data = await res.json();");
    expect(responseOf({ ...sample, response: null })).toBe("(sem corpo)");
    expect(fetchOf({ ...sample, binary: true })).toContain("arrayBuffer");
  });
});
