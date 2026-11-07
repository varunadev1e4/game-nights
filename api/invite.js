import { createClient } from '@supabase/supabase-js'
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  const { data: u } = await admin.auth.getUser(token)
  if (!u?.user) return res.status(401).json({ error: 'Not signed in' })
  const { data: p } = await admin.from('profiles').select('is_admin').eq('id', u.user.id).single()
  if (!p?.is_admin) return res.status(403).json({ error: 'Admins only' })
  const { email, password, display_name } = req.body
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name } })
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
}
