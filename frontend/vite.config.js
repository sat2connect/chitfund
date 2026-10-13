import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Variables whose names start with this are bundled into the page (and are therefore PUBLIC). The API address is
  // read from a variable named exactly VITE; the older VITE_API_BASE_URL keeps working. Never put a secret in either.
  envPrefix: 'VITE',
  server: { port: 5173 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.js'] },
});
