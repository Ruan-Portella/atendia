import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": "next/dist/compiled/server-only/empty.js" } },
  test: { environment: "node", include: ["src/**/*.test.ts"], setupFiles: ["src/test-setup.ts"] },
});
