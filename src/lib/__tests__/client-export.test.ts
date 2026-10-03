import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, csvCell, sharedPortfolios, toCsv, whatsappSituation, type ClientExportRow } from "../client-export";

const row = (o: Partial<ClientExportRow> = {}): ClientExportRow => ({
  agencyId: "a1",
  agencyName: "Ruan Marketing",
  ownerEmail: "dono@agencia.com",
  planName: "Escala",
  agencySituation: "Pagante",
  clientId: "c1",
  clientName: "Fintra",
  botId: "b1",
  botName: "Assistente",
  botStatus: "live",
  botCreatedAt: "2026-09-01T15:00:00Z",
  chunks: 42,
  waPhone: "+55 21 98765-4321",
  wabaId: "1111",
  businessId: "9999",
  coexistence: false,
  waConnectedAt: "2026-09-02T15:00:00Z",
  waDisconnectedAt: null,
  waDisconnectReason: null,
  igUsername: "fintra",
  igConnected: true,
  complianceStatus: "ativo",
  ...o,
});

describe("lista de clientes em CSV", () => {
  it("cabeçalho em português, ponto e vírgula e BOM para o Excel", () => {
    const csv = toCsv([row()]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [head, line] = csv.slice(1).split("\r\n");
    expect(head.split(";")).toHaveLength(EXPORT_COLUMNS.length);
    expect(head).toContain("Portfólio da Meta (business_id)");
    expect(line).toContain("Ruan Marketing;dono@agencia.com;Escala;Pagante;Fintra;ativo;Assistente;publicado;42");
    expect(line).toContain("@fintra");
  });

  it("célula com fórmula vira texto; com ponto e vírgula ou aspas vai entre aspas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+55 21 98765-4321")).toBe("'+55 21 98765-4321");
    expect(csvCell("Bar; Restaurante")).toBe('"Bar; Restaurante"');
    expect(csvCell(7)).toBe("7");
  });

  it("situação do WhatsApp", () => {
    expect(whatsappSituation(row({ waPhone: null, wabaId: null, waConnectedAt: null }))).toBe("sem WhatsApp");
    expect(whatsappSituation(row())).toBe("conectado desde 02/09/2026");
    expect(whatsappSituation(row({ waDisconnectedAt: "2026-09-10T15:00:00Z", waDisconnectReason: "conta excluída" }))).toBe("desconectado em 10/09/2026 (conta excluída)");
  });
});

describe("mesmo portfólio da Meta em clientes diferentes", () => {
  it("alerta só quando o portfólio aparece em mais de um cliente (conectado)", () => {
    const rows = [
      row({ clientId: "c1", clientName: "Fintra", businessId: "9999" }),
      row({ clientId: "c2", clientName: "Bar do Zé", botName: "Bar", businessId: "9999" }),
      row({ clientId: "c3", clientName: "Outro", businessId: "8888" }),
      // dois chatbots do mesmo cliente com o mesmo portfólio: normal
      row({ clientId: "c3", clientName: "Outro", botName: "Loja 2", businessId: "8888" }),
      // desconectado não conta
      row({ clientId: "c4", clientName: "Antigo", businessId: "8888", waDisconnectedAt: "2026-09-10T15:00:00Z" }),
    ];
    const shared = sharedPortfolios(rows);
    expect(shared.map((s) => s.businessId)).toEqual(["9999"]);
    expect(shared[0].clients.map((c) => c.clientName)).toEqual(["Fintra", "Bar do Zé"]);
  });
});
