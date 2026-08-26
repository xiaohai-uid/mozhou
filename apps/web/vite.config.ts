import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { moZhouApi } from './server/api'

export default defineConfig({
  plugins: [react(), moZhouApi()],
  server: { port: 5173 },
})
