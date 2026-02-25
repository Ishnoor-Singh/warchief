import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy PartyKit WebSocket connections during dev
      '/parties': {
        target: 'ws://localhost:1999',
        ws: true,
      },
    },
  },
})
