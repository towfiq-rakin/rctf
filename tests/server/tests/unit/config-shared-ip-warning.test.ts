import { config } from '@rctf/config'
import { describe, expect, test } from 'bun:test'
import { ServerConfigSchema } from '../../../../packages/config/src/types'

describe('config sharedIpWarning', () => {
  test('defaults to true when omitted', () => {
    const { sharedIpWarning: _omitted, ...rest } = config
    expect(ServerConfigSchema.parse(rest).sharedIpWarning).toBe(true)
  })

  test('accepts explicit true and false', () => {
    for (const enabled of [true, false]) {
      const parsed = ServerConfigSchema.parse({
        ...config,
        sharedIpWarning: enabled,
      })
      expect(parsed.sharedIpWarning).toBe(enabled)
    }
  })

  test('rejects non-boolean values', () => {
    for (const value of ['false', 0, null]) {
      expect(
        ServerConfigSchema.safeParse({ ...config, sharedIpWarning: value })
          .success
      ).toBe(false)
    }
  })
})
