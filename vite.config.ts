/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Separa as bibliotecas em chunks próprios: o código do app muda com mais
        // frequência e o navegador mantém as dependências em cache.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('@mui/icons-material')) return 'mui-icons';
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui';
          if (id.includes('react')) return 'react';
          return 'vendor';
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
