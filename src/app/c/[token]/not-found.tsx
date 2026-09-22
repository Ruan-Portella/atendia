import { InactiveLink } from "@/components/inactive-link";

export const metadata = { title: { absolute: "Link inativo" }, robots: { index: false } };

export default function PortalNotFound() {
  return <InactiveLink title="Este link não está mais ativo" text="O endereço do relatório foi trocado ou desligado. Peça o link novo para quem te enviou." />;
}
