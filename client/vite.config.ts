import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.SOUNDFY_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  // hls.js is loaded lazily, only for HLS streams (some VK tracks).
  build: { chunkSizeWarningLimit: 600 },
  server: {
    port: 5173,
    proxy: { '/api': backend, '/media': backend },
  },
});
