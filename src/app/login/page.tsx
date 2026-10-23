import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { loginCodeEnabled } from "@/lib/login-code";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    // redesenho (23/10/2026): o painel da marca ao lado do formulário no computador
    <AuthShell headline="Bem-vindo de volta. Suas conversas estão te esperando.">
      <Suspense>
        <AuthForm mode="login" emailEnabled={loginCodeEnabled()} />
      </Suspense>
    </AuthShell>
  );
}
