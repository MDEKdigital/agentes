import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["cjs"],
  clean: true,
  // Bundle workspace packages AND ws so the runner never needs to resolve them
  noExternal: [/@aula-agente\/.*/, "ws"],
});
