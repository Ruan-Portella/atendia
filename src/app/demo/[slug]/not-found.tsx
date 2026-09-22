import { InactiveLink } from "@/components/inactive-link";

export const metadata = { title: { absolute: "Demonstração indisponível" }, robots: { index: false } };

export default function DemoNotFound() {
  return <InactiveLink title="Esta demonstração não está mais disponível" text="Ela pode ter virado um assistente de verdade ou sido removida. Fale com quem te enviou o link." />;
}
