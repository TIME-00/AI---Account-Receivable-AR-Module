import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Batch 9D-D: Vitest + Testing Library setup for the Multi-Currency UX.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    // Non-secret placeholders. `src/lib/supabase.ts` constructs a browser client
    // at module load, which any import of `use-api` transitively triggers. These
    // are syntactically valid dummies pointing nowhere: no test performs a real
    // network call (the API boundary is mocked in src/test/harness.tsx), and no
    // real credential is present in this repository or in test output.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-not-a-real-credential",
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:54321/functions/v1",
      NEXT_PUBLIC_DEFAULT_COMPANY_ID: "00000000-0000-0000-0000-000000000000",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
