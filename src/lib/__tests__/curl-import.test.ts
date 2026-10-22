import { describe, expect, it } from "vitest";
import { parseCurl, shellWords } from "@/lib/curl-import";

describe("shellWords", () => {
  it("separa como o shell: aspas e barra no fim da linha", () => {
    expect(shellWords(`curl -X POST 'https://a.com/x' \\\n  -H "Authorization: Bearer abc" -d '{"a": 1}'`)).toEqual(["curl", "-X", "POST", "https://a.com/x", "-H", "Authorization: Bearer abc", "-d", '{"a": 1}']);
  });
  it("mantém a palavra vazia entre aspas", () => {
    expect(shellWords(`curl -d '' https://a.com`)).toEqual(["curl", "-d", "", "https://a.com"]);
  });
});

describe("parseCurl", () => {
  it("lê o endereço, os cabeçalhos e os parâmetros do corpo em JSON", () => {
    const r = parseCurl(`curl --request POST \\
      --url https://api.loja.com/v1/pedidos/consultar \\
      --header 'x-api-key: 123' \\
      --header 'Content-Type: application/json' \\
      --header 'Accept: */*' \\
      --data '{"numeroPedido": "1042", "quantidade": 2, "valor": 9.5, "urgente": true, "itens": ["a"]}'`);
    expect(r).toEqual({
      url: "https://api.loja.com/v1/pedidos/consultar",
      headers: [{ name: "x-api-key", value: "123" }],
      params: [
        { name: "numero_pedido", type: "string" },
        { name: "quantidade", type: "integer" },
        { name: "valor", type: "number" },
        { name: "urgente", type: "boolean" },
        { name: "itens", type: "array" },
      ],
      name: "pedidos_consultar",
    });
  });

  it("aceita corpo de formulário e o endereço solto", () => {
    expect(parseCurl("curl https://a.com/agendar -d 'servico=corte&dia=sexta'")?.params).toEqual([
      { name: "servico", type: "string" },
      { name: "dia", type: "string" },
    ]);
  });

  it("sem endereço HTTPS, não importa", () => {
    expect(parseCurl("curl http://a.com/x")).toBeNull();
    expect(parseCurl("isto não é um curl")).toBeNull();
  });

  it("deixa de fora os cabeçalhos de assinatura e o prefixo boavoz_", () => {
    const r = parseCurl(`curl https://a.com/x -H 'webhook-signature: v1,abc' -d '{"boavoz_x": 1, "cep": "01001000"}'`);
    expect(r?.headers).toEqual([]);
    expect(r?.params).toEqual([{ name: "cep", type: "string" }]);
  });
});
