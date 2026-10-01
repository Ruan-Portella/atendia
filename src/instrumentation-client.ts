import * as Sentry from "@sentry/nextjs";
import { baseOptions } from "@/lib/sentry-options";

// Monitor de erros no navegador: sem replay de sessão (gravaria o que o visitante digita).
Sentry.init(baseOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
