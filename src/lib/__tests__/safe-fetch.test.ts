import { describe, expect, it } from "vitest";
import { BlockedUrlError, checkUrl, isPrivateAddress, safeFetch } from "../safe-fetch";
import { fetchPage } from "../ingest";

describe("endereços internos", () => {
  it("recusa loopback, rede privada, metadados da nuvem e IPv6 local", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("deixa passar IP público", () => {
    for (const ip of ["8.8.8.8", "104.21.3.4", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("checa a URL antes de conectar", () => {
    expect(checkUrl("https://clinicasorriso.com.br/x").hostname).toBe("clinicasorriso.com.br");
    for (const u of ["file:///etc/passwd", "http://127.0.0.1/", "http://[::1]/", "http://localhost/", "http://app.localhost/", "http://site.com:8080/", "http://user:pw@site.com/", "http://169.254.169.254/latest/meta-data/"]) {
      expect(() => checkUrl(u), u).toThrow(BlockedUrlError);
    }
  });

  it("não busca nome que resolve para endereço interno", async () => {
    await expect(safeFetch("http://localtest.me/")).rejects.toThrow();
    expect(await fetchPage("http://127.0.0.1:3000/")).toBeNull();
  });
});
