import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Content Security Policy applied to production builds only.
// - 'self' for scripts/fonts/images (no CDNs, no Google Fonts at runtime)
// - 'unsafe-inline' for styles (the app uses extensive inline styles)
// - connect-src allows local agents over http/ws and everything over https/wss
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* ws://* wss://* https://*",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * Injects a strict CSP <meta> tag into the built HTML only.
 * Dev mode is left unconstrained so Vite's inline HMR preamble works.
 */
function cspPlugin() {
  let isBuild = false;
  return {
    name: "open-chat-csp",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    transformIndexHtml(html) {
      if (!isBuild) return html;
      const meta = `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`;
      return html.replace(/<meta charset="UTF-8" \/>/, `$&${meta}`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin()],
  server: {
    port: 5173,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
        },
      },
    },
  },
  preview: {
    headers: {
      "Content-Security-Policy": PROD_CSP,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
    },
  },
});
