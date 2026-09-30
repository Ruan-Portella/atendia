import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch, type Response } from "undici";

/*
 * Busca de URLs que vêm de fora (fontes do chatbot, demo da landing). Sem isto, quem cadastra
 * uma URL consegue fazer o servidor abrir endereços internos (169.254.169.254, localhost,
 * rede privada). A checagem vale na hora de conectar (depois do DNS, então rebinding não
 * passa) e em cada redirecionamento.
 */

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96], ["2002::", 16], ["100::", 64],
] as const) blocked.addSubnet(net, bits, "ipv6");

/** Endereço fora da internet pública (loopback, rede privada, link-local, metadados da nuvem…). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, "ipv4");
  if (v !== 6) return true;
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  // ::ffff:7f00:1 (IPv4 mapeado em hexa) também é loopback
  if (/^::ffff:/i.test(ip)) return true;
  return blocked.check(ip, "ipv6");
}

export class BlockedUrlError extends Error {}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** lookup do socket: resolve e recusa se qualquer endereço for interno. */
function safeLookup(hostname: string, options: object, cb: LookupCb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return cb(new BlockedUrlError(`endereço interno: ${hostname}`), []);
    if ((options as { all?: boolean }).all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup as never }, connections: 20 });

/** URL que pode ser buscada: http(s), porta padrão e host que não é IP interno. */
export function checkUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("protocolo");
  if (u.port && u.port !== "80" && u.port !== "443") throw new BlockedUrlError("porta");
  if (u.username || u.password) throw new BlockedUrlError("credenciais na URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) throw new BlockedUrlError(`endereço interno: ${host}`);
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new BlockedUrlError(`endereço interno: ${host}`);
  return u;
}

/** GET seguro com até `maxRedirects` redirecionamentos, cada um checado. Devolve a URL final. */
export async function safeFetch(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal; maxRedirects?: number } = {}): Promise<{ res: Response; url: string }> {
  let current = checkUrl(url);
  for (let hop = 0; ; hop++) {
    const res = await undiciFetch(current, { headers: init.headers, signal: init.signal, redirect: "manual", dispatcher: agent });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { res, url: current.toString() };
    await res.body?.cancel();
    if (hop >= (init.maxRedirects ?? 5)) throw new BlockedUrlError("redirecionamentos demais");
    current = checkUrl(new URL(location, current).toString());
  }
}
