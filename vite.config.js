import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Cargo continuously rewrites and locks executables in this directory on
      // Windows. Rust source changes are already watched by `tauri dev`, so
      // letting Vite watch build artifacts can terminate the dev server with
      // EBUSY while the linker is writing an executable.
      ignored: ['**/src-tauri/target/**'],
    },
  },
  resolve: {
    // Ensure UI packages use the application's React instance.
    dedupe: ['react', 'react-dom'],
  },
});
