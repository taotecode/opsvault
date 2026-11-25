import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:8080';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: Number(env.WEB_PORT || 5173),
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, ws: true },
        '/mcp': { target: apiTarget, changeOrigin: true },
      },
    },
    build: { outDir: 'dist', sourcemap: false },
  };
});
