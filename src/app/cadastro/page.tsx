import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { loginCodeEnabled } from "@/lib/login-code";

export const metadata = { title: "Criar conta" };

export default function SignupPage() {
  return (
    // redesenho (23/10/2026): o painel da marca ao lado do formulário no computador
    <AuthShell headline="Monte o assistente do seu cliente em minutos.">
      <Suspense>
        <AuthForm mode="signup" emailEnabled={loginCodeEnabled()} />
      </Suspense>
    </AuthShell>
  );
}
