import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { Agent } from "node:http";
import { fileURLToPath } from "node:url";

// Load ports and proxy target from the root .env so parallel worktrees can use distinct ports.
// Vite runs from web/, and loadEnvFile intentionally preserves values already exported by the shell.
if (process.env.KITH_SPACE_DESKTOP_MANAGED !== "1") {
  try { (process as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.("../.env"); } catch { /* use defaults when .env is absent */ }
}
const API = `http://127.0.0.1:${process.env.PORT ?? 7777}`;
const coreProxyAgent = new Agent({ keepAlive: true });
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 5273),
    strictPort: true,
    proxy: {
      // Preserve the browser-visible Host so Core can compare it with Origin for browser-session CSRF checks.
      "/api": { target: API, changeOrigin: false, agent: coreProxyAgent },
      "/socket.io": { target: API, ws: true, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Stable framework — cached longest; separate from app code
          "react-vendor": [
            "react",
            "react-dom",
            "react-dom/client",
            "react-router-dom",
          ],
          // Shared shadcn/Radix primitives
          "ui-vendor": ["radix-ui"],
          // Heavy markdown pipeline (react-markdown + plugins)
          "markdown": ["react-markdown", "rehype-raw", "rehype-sanitize", "remark-breaks", "remark-gfm"],
          // Drag-and-drop
          "dnd": ["@dnd-kit/core"],
          // Internationalisation
          "i18n": ["i18next", "react-i18next"],
          // Avatar generation (dicebear)
          "avatars": ["@dicebear/core", "@dicebear/collection"],
          // Real-time transport
          "socket": ["socket.io-client"],
        },
      },
    },
  },
});
