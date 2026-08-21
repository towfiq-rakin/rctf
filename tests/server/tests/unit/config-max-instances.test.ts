import { describe, expect, test } from 'bun:test'
import { loadEnvConfig } from '../../../../packages/config/src/loader'
import { normalizeConfig } from '../../../../packages/config/src/normalize'
import { ServerConfigSchema } from '../../../../packages/config/src/types'

describe('config maxInstances', () => {
  test('accepts valid maxInstances in schema', () => {
    const parsed = ServerConfigSchema.safeParse({
      ctfName: 'Test CTF',
      origin: 'http://localhost',
      tokenKey: 'dGVzdC10b2tlbi1rZXktMzItYnl0ZXMtc3RyaW5nIQ==',
      database: {
        sql: 'postgres://localhost/test',
        redis: 'redis://localhost/0',
      },
      startTime: 1000,
      endTime: 2000,
      maxInstances: 3,
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.maxInstances).toBe(3)
    }
  })

  test('rejects maxInstances < 1', () => {
    const parsed = ServerConfigSchema.safeParse({
      ctfName: 'Test CTF',
      origin: 'http://localhost',
      tokenKey: 'dGVzdC10b2tlbi1rZXktMzItYnl0ZXMtc3RyaW5nIQ==',
      database: {
        sql: 'postgres://localhost/test',
        redis: 'redis://localhost/0',
      },
      startTime: 1000,
      endTime: 2000,
      maxInstances: 0,
    })

    expect(parsed.success).toBe(false)
  })

  test('normalizes maxInstance to maxInstances', () => {
    const raw = {
      ctfName: 'Test CTF',
      origin: 'http://localhost',
      tokenKey: 'dGVzdC10b2tlbi1rZXktMzItYnl0ZXMtc3RyaW5nIQ==',
      database: {
        sql: 'postgres://localhost/test',
        redis: 'redis://localhost/0',
      },
      startTime: 1000,
      endTime: 2000,
      maxInstance: 4,
    }

    const parsed = ServerConfigSchema.parse(raw)
    const normalized = normalizeConfig(parsed)
    expect(normalized.maxInstances).toBe(4)
  })

  test('loads RCTF_MAX_INSTANCES from environment', () => {
    process.env.RCTF_MAX_INSTANCES = '5'
    const envConfig = loadEnvConfig()
    expect(envConfig.maxInstances).toBe(5)
    delete process.env.RCTF_MAX_INSTANCES
  })

  test('loads RCTF_MAX_INSTANCE fallback from environment', () => {
    process.env.RCTF_MAX_INSTANCE = '2'
    const envConfig = loadEnvConfig()
    expect(envConfig.maxInstances).toBe(2)
    delete process.env.RCTF_MAX_INSTANCE
  })
})
