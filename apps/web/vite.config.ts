import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { moZhouApi } from './server/api'

export default defineConfig({
  plugins: [react(), tailwindcss(), moZhouApi()],
  server: { port: 5173 },
})
