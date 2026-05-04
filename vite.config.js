import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vercel-friendly Vite config:
// - chunkSizeWarningLimit bumped to 2 MB so the single-file 36k-line app
//   doesn't trip the warning (chunking it would just add complexity for
//   no real benefit since the entire app loads on the first paint anyway).
// - sourcemap disabled to keep the production bundle as small as possible.
//   Vercel's build cache benefits from a smaller deploy artifact.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
});
