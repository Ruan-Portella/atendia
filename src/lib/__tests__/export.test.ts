import { describe, expect, it } from "vitest";
import { exportResponse } from "../export";

async function* rows(list: Array<Record<string, string | null>>) {
  for (const r of list) yield r;
}

describe("exportação dos dados do negócio", () => {
  it("CSV para o Excel em português: BOM, ponto e vírgula e aspas", async () => {
    const res = exportResponse(rows([{ data: "2026-10-01", nome: "Ana; da Silva", interesse: 'quer "pizza"\ngrande', telefone: null }]), "leads", "csv", "loja-leads");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="loja-leads.csv"');
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, line] = (await res.text()).split("\r\n");
    expect(header).toBe("Data;Assistente;Conversa;Nome;Telefone;E-mail;Instagram;Canal;Interesse");
    expect(line).toBe('2026-10-01;;;"Ana; da Silva";;;;;"quer ""pizza""\ngrande"');
  });

  it("JSON: lista de objetos com as colunas do conjunto, e conta as linhas", async () => {
    let count = -1;
    const res = exportResponse(rows([{ id: "c1", canal: "WhatsApp", telefone: "5521999990000", extra: "não sai" }, { id: "c2" }]), "contatos", "json", "x", (n) => (count = n));
    const data = JSON.parse(await res.text());
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ id: "c1", canal: "WhatsApp", telefone: "5521999990000", nome: null });
    expect(data[0].extra).toBeUndefined();
    expect(count).toBe(2);
  });
});
