import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    nodePolyfills({ include: ['buffer', 'process', 'crypto', 'stream', 'util', 'events'], globals: { Buffer: true, process: true, global: true } }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/gsap') || id.includes('node_modules/lenis')) return 'motion';
          if (id.includes('@solana/wallet-adapter')) return 'wallet';
          if (id.includes('node_modules/@coral-xyz') || id.includes('node_modules/@solana/web3.js') || id.includes('node_modules/bn.js') || id.includes('node_modules/borsh')) return 'solana';
        },
      },
    },
  },
});
