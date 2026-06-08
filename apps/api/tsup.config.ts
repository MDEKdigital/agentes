import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["cjs"],
  clean: true,
  // Bundle workspace packages into the output so the runner image
  // doesn't need TypeScript source at runtime
  noExternal: [/@aula-agente\/.*/],
});
