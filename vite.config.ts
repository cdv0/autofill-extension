import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [
    react(), // Enables react support
    crx({ manifest }), // Helps turn the Vite app into a Chrome extension build
  ],
});