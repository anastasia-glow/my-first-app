import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // During `npm run dev`, send /api requests to the Python API on port 8000
    proxy: { '/api': 'http://localhost:8000' },
  },
})
