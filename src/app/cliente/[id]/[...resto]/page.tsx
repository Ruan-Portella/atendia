import { notFound } from "next/navigation";

/**
 * Endereço que não existe dentro da área do cliente: cai no "não encontrado" da própria área
 * (com o menu e a marca da agência), em vez do 404 geral, que leva para o site da BoaVoz.
 */
export default function MemberUnknownPage() {
  notFound();
}
