// eslint-disable-next-line unicorn/prefer-node-protocol
import { timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { cors } from 'hono/cors'
import { checkKey, getEnv } from './utils.ts'
import type { Database } from './supabase.types.ts'
import { supabaseAdmin } from './supabase.ts'

export const useCors = cors({
  origin: '*',
  allowHeaders: ['*'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
})

export function middlewareKey(rights: Database['public']['Enums']['key_mode'][]) {
  const subMiddlewareKey: MiddlewareHandler<{
    Variables: {
      apikey: Database['public']['Tables']['apikeys']['Row'] | null
    }
  }> = async (c: Context, next: Next) => {
    const capgkey_string = c.req.header('capgkey')
    const apikey_string = c.req.header('authorization')
    const key = capgkey_string || apikey_string
    const apikey: Database['public']['Tables']['apikeys']['Row'] | null = await checkKey(key, supabaseAdmin(c), rights)
    if (!apikey)
      throw new HTTPException(400, { message: 'Invalid apikey' })
    c.set('apikey', apikey)
    c.set('capgkey', key)
    await next()
  }
  return subMiddlewareKey
}

export async function getBody<T>(c: Context) {
  let body: T
  try {
    body = await c.req.json<T>()
  }
  catch (_e) {
    body = await c.req.query() as any as T
  }
  if (!body)
    throw new HTTPException(400, { message: 'Cannot find body' })
  return body
}

export const middlewareAuth: MiddlewareHandler<{
  Variables: {
    authorization: string
  }
}> = async (c: Context, next: Next) => {
  const authorization = c.req.header('authorization')
  if (!authorization)
    throw new HTTPException(400, { message: 'Cannot find authorization' })
  c.set('authorization', authorization)
  await next()
}

export const middlewareAPISecret: MiddlewareHandler<{
  Variables: {
    APISecret: string
  }
}> = async (c: Context, next: Next) => {
  const authorizationSecret = c.req.header('apisecret')
  const API_SECRET = getEnv(c, 'API_SECRET')

  // Here to prevent a timing attack
  const encoder = new TextEncoder()
  const a = encoder.encode(authorizationSecret)
  const b = encoder.encode(API_SECRET)

  if (!authorizationSecret || !API_SECRET || !timingSafeEqual(a, b))
    throw new HTTPException(400, { message: 'Cannot find authorization' })
  c.set('APISecret', authorizationSecret)
  await next()
}

export const BRES = { status: 'ok' }