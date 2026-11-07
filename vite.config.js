import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Runs the files in /api during `npm run dev`, the same way Vercel runs them when deployed.
const apiDev = env => ({
  name: 'api-dev',
  configureServer(server) {
    Object.assign(process.env, env)
    server.middlewares.use('/api', async (req, res) => {
      const send = (code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) }
      try {
        let raw = ''
        for await (const c of req) raw += c
        req.body = raw ? JSON.parse(raw) : {}
        res.status = c => { res.statusCode = c; return res }
        res.json = o => send(res.statusCode || 200, o)
        const mod = await server.ssrLoadModule(`/api/${req.url.split('?')[0].replace(/^\//, '')}.js`)
        await mod.default(req, res)
      } catch (e) { send(500, { error: e.message }) }
    })
  }
})

export default defineConfig(({ mode }) => ({
  plugins: [react(), apiDev(loadEnv(mode, process.cwd(), ''))],
  resolve: { dedupe: ['react', 'react-dom'] },
  // Pre-bundle everything up front so Vite never re-optimizes mid-session (that causes two copies of React).
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', '@supabase/supabase-js', '@tanstack/react-query', '@tanstack/react-query-persist-client', '@tanstack/query-sync-storage-persister'] }
}))
