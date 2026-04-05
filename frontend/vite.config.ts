import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/sleep_tracker/frontend/",
  build: {
    rollupOptions: {
      input: {
        "sleep-tracker-panel": resolve(__dirname, "src/sleep-tracker-panel.ts"),
        "sleep-tracker-card": resolve(__dirname, "src/sleep-tracker-card.ts"),
        "sleep-tracker-cards": resolve(__dirname, "src/sleep-tracker-cards.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
      },
    },
    outDir: "../custom_components/sleep_tracker/frontend/dist",
    emptyOutDir: true,
  },
});
