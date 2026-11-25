import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strenge Content-Security-Policy nur im Build (der Dev-Server braucht Inline-Skripte für Hot Reload).
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'",
      },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  plugins: [react(), csp],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
