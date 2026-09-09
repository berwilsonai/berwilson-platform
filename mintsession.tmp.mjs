import { createClient } from '@supabase/supabase-js'
import { serialize } from 'cookie'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const admin = createClient(url, svc, { auth:{autoRefreshToken:false,persistSession:false} })
const { data: users } = await admin.auth.admin.listUsers()
const me = users.users.find(u=>u.email?.includes('info@')) ?? users.users[0]
const { data: link, error } = await admin.auth.admin.generateLink({ type:'magiclink', email: me.email })
if (error) throw new Error(error.message)
const pub = createClient(url, anon, { auth:{autoRefreshToken:false,persistSession:false} })
const { data: sess, error: e2 } = await pub.auth.verifyOtp({ type:'magiclink', token_hash: link.properties.hashed_token })
if (e2) throw new Error(e2.message)
const ref = new URL(url).hostname.split('.')[0]
const key = `sb-${ref}-auth-token`
const payload = Buffer.from(JSON.stringify(sess.session)).toString('base64')
console.log(`${key}=base64-${payload}`)
