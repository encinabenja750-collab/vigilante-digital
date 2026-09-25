import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    minify: false, // ¡EL ARREGLO DE RAÍZ!: Prohíbe que Vite deforme las variables del HTML e inyectables
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "index.html"),
        content: resolve(__dirname, "src/content.jsx"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === "content"
            ? "content.js"
            : "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
