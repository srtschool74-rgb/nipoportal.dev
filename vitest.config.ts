import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/consistency/**/*.test.ts"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
      "@/backend": path.resolve(__dirname, "./backend"),
      "@/frontend": path.resolve(__dirname, "./frontend"),
      "@/types": path.resolve(__dirname, "./frontend/types"),
      "@/app": path.resolve(__dirname, "./app"),
      "@/lib": path.resolve(__dirname, "./lib"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
