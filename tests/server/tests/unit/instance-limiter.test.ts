import { describe, expect, test } from 'bun:test'
import RedisMock from 'ioredis-mock'
import { InstanceStatus } from '@rctf/types'
import {
  recordInstanceExtended,
  recordInstanceStarted,
  recordInstanceStopped,
  reserveInstanceSlot,
  syncInstanceStatus,
  teamInstancesKey,
} from '../../../../apps/api/src/cache/instance-limiter'
import {
  loadLuaCommands,
  type TypedRedis,
} from '../../../../apps/api/src/cache/scripts'

const redisPromise = loadLuaCommands(new RedisMock())
const createRedis = async (): Promise<TypedRedis> => {
  const redis = await redisPromise
  await redis.flushdb()
  return redis
}

describe('instance-limiter', () => {
  test('atomically admits only one concurrent reservation', async () => {
    const redis = await createRedis()

    const results = await Promise.all([
      reserveInstanceSlot(redis, 'team-race', 'chall-1', 1, 60000),
      reserveInstanceSlot(redis, 'team-race', 'chall-2', 1, 60000),
    ])

    expect(results.sort()).toEqual(['limit', 'reserved'])
    expect(await redis.zcard(teamInstancesKey('team-race'))).toBe(1)
  })

  test('records started, extended, stopped instances in Redis ZSET', async () => {
    const redis = await createRedis()
    const teamId = 'team-test-1'
    const key = teamInstancesKey(teamId)

    // Record instance start
    await recordInstanceStarted(redis, teamId, 'chall-1', 60000)
    let score = await redis.zscore(key, 'chall-1')
    expect(score).not.toBeNull()
    expect(Number(score)).toBeGreaterThan(Date.now() / 1000)

    // Record instance extend
    await recordInstanceExtended(redis, teamId, 'chall-1', 120000)
    const newScore = await redis.zscore(key, 'chall-1')
    expect(Number(newScore)).toBeGreaterThan(Number(score))
    expect(await redis.ttl(key)).toBe(-1)

    // Record instance stop
    await recordInstanceStopped(redis, teamId, 'chall-1')
    score = await redis.zscore(key, 'chall-1')
    expect(score).toBeNull()
  })

  test('enforces maxInstances limit properly', async () => {
    const redis = await createRedis()
    const teamId = 'team-limit-1'

    // Limit is 2
    const maxInstances = 2

    expect(
      await reserveInstanceSlot(redis, teamId, 'chall-1', maxInstances, 60000)
    ).toBe('reserved')

    expect(
      await reserveInstanceSlot(redis, teamId, 'chall-2', maxInstances, 60000)
    ).toBe('reserved')

    // Attempting 3rd challenge should be blocked
    expect(
      await reserveInstanceSlot(redis, teamId, 'chall-3', maxInstances, 60000)
    ).toBe('limit')

    // Attempting already active challenge should be allowed
    expect(
      await reserveInstanceSlot(redis, teamId, 'chall-1', maxInstances, 60000)
    ).toBe('existing')

    // Stop chall-1
    await recordInstanceStopped(redis, teamId, 'chall-1')

    // Now chall-3 should be allowed
    expect(
      await reserveInstanceSlot(redis, teamId, 'chall-3', maxInstances, 60000)
    ).toBe('reserved')
  })

  test('keeps expired leases until provider reconciliation', async () => {
    const redis = await createRedis()
    const teamId = 'team-expired-1'
    const key = teamInstancesKey(teamId)

    // Add an expired instance (timestamp in past)
    await redis.zadd(key, Date.now() / 1000 - 5, 'chall-old')
    await recordInstanceStarted(redis, teamId, 'chall-active', 60000)

    // Expiration is only a hint. Admission fails closed until the provider
    // confirms that the old instance is terminal.
    expect(
      await reserveInstanceSlot(redis, teamId, 'chall-new', 2, 60000)
    ).toBe('limit')

    // The expired one remains available for provider reconciliation.
    const oldScore = await redis.zscore(key, 'chall-old')
    expect(oldScore).not.toBeNull()
  })

  test('syncInstanceStatus updates Redis on stopped or running', async () => {
    const redis = await createRedis()
    const teamId = 'team-sync-1'
    const key = teamInstancesKey(teamId)

    await syncInstanceStatus(redis, teamId, 'chall-1', {
      kind: 'instancerInstanceDetails',
      status: InstanceStatus.RUNNING,
      timeLeftMilliseconds: 30000,
      endpoints: [],
    })

    let score = await redis.zscore(key, 'chall-1')
    expect(score).not.toBeNull()

    await syncInstanceStatus(redis, teamId, 'chall-1', {
      kind: 'instancerInstanceDetails',
      status: InstanceStatus.STOPPED,
      timeLeftMilliseconds: 0,
      endpoints: null,
    })

    score = await redis.zscore(key, 'chall-1')
    expect(score).toBeNull()
  })

  test('counts starting instances that report zero time left', async () => {
    const redis = await createRedis()
    const teamId = 'team-starting'

    await syncInstanceStatus(
      redis,
      teamId,
      'chall-1',
      {
        kind: 'instancerInstanceDetails',
        status: InstanceStatus.STARTING,
        timeLeftMilliseconds: 0,
        endpoints: [],
      },
      120000
    )

    const score = await redis.zscore(teamInstancesKey(teamId), 'chall-1')
    expect(Number(score)).toBeGreaterThan(Date.now() / 1000 + 60)
    expect(await reserveInstanceSlot(redis, teamId, 'chall-2', 1, 60000)).toBe(
      'limit'
    )
  })

  test('preserves an active lease on provider errors', async () => {
    const redis = await createRedis()
    const teamId = 'team-provider-error'

    await recordInstanceStarted(redis, teamId, 'chall-1', 60000)
    expect(
      await syncInstanceStatus(redis, teamId, 'chall-1', {
        kind: 'instancerError',
        message: 'temporary provider failure',
      })
    ).toBe('unavailable')

    expect(
      await redis.zscore(teamInstancesKey(teamId), 'chall-1')
    ).not.toBeNull()
  })
})
