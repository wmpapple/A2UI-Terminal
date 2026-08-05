import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Ensure UI packages use the application's React instance.
    dedupe: ['react', 'react-dom'],
  },
});
