import { createClient } from '@supabase/supabase-js'

// Public endpoint: creates a member account when the club code is right. Uses the service key, which never reaches the browser.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { name, email, password, code } = req.body || {}
  if (!name?.trim() || !email?.trim() || !password || !code?.trim()) return res.status(400).json({ error: 'Please fill in every field.' })
  if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' })
  const { data: rows } = await admin.from('club_settings').select('key,value').in('key', ['join_code', 'join_open'])
  const s = Object.fromEntries((rows || []).map(r => [r.key, r.value]))
  if (s.join_open !== 'true') return res.status(403).json({ error: 'Joining is closed right now. Ask the host.' })
  if (code.trim().toLowerCase() !== String(s.join_code).toLowerCase()) return res.status(403).json({ error: 'That club code is not right.' })
  const { error } = await admin.auth.admin.createUser({ email: email.trim(), password, email_confirm: true, user_metadata: { display_name: name.trim() } })
  if (error) return res.status(400).json({ error: /already|registered/i.test(error.message) ? 'That email already has an account. Try signing in.' : error.message })
  res.json({ ok: true })
}
