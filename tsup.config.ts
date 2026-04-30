import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  dts: false,
  sourcemap: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
})
