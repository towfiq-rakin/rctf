import { describe, expect, test } from 'bun:test'
import RedisMock from 'ioredis-mock'
import { InstanceStatus } from '@rctf/types'
import {
  canTeamStartInstance,
  recordInstanceExtended,
  recordInstanceStarted,
  recordInstanceStopped,
  syncInstanceStatus,
  teamInstancesKey,
} from '../../../../apps/api/src/cache/instance-limiter'
import type { TypedRedis } from '../../../../apps/api/src/cache/scripts'

describe('instance-limiter', () => {
  test('allows starting instances when maxInstances is not set or 0', async () => {
    const redis = new RedisMock() as unknown as TypedRedis
    const mockDb = {} as any

    expect(
      await canTeamStartInstance(redis, mockDb, 'team-1', 'chall-1', undefined)
    ).toBe(true)
    expect(
      await canTeamStartInstance(redis, mockDb, 'team-1', 'chall-1', 0)
    ).toBe(true)
  })

  test('records started, extended, stopped instances in Redis ZSET', async () => {
    const redis = new RedisMock() as unknown as TypedRedis
    const teamId = 'team-test-1'
    const key = teamInstancesKey(teamId)

    // Record instance start
    await recordInstanceStarted(redis, teamId, 'chall-1', 60000)
    let score = await redis.zscore(key, 'chall-1')
    expect(score).not.toBeNull()
    expect(Number(score)).toBeGreaterThan(Date.now())

    // Record instance extend
    await recordInstanceExtended(redis, teamId, 'chall-1', 120000)
    const newScore = await redis.zscore(key, 'chall-1')
    expect(Number(newScore)).toBeGreaterThan(Number(score))

    // Record instance stop
    await recordInstanceStopped(redis, teamId, 'chall-1')
    score = await redis.zscore(key, 'chall-1')
    expect(score).toBeNull()
  })

  test('enforces maxInstances limit properly', async () => {
    const redis = new RedisMock() as unknown as TypedRedis
    const mockDb = {} as any
    const teamId = 'team-limit-1'

    // Limit is 2
    const maxInstances = 2

    expect(
      await canTeamStartInstance(redis, mockDb, teamId, 'chall-1', maxInstances)
    ).toBe(true)
    await recordInstanceStarted(redis, teamId, 'chall-1', 60000)

    expect(
      await canTeamStartInstance(redis, mockDb, teamId, 'chall-2', maxInstances)
    ).toBe(true)
    await recordInstanceStarted(redis, teamId, 'chall-2', 60000)

    // Attempting 3rd challenge should be blocked
    expect(
      await canTeamStartInstance(redis, mockDb, teamId, 'chall-3', maxInstances)
    ).toBe(false)

    // Attempting already active challenge should be allowed
    expect(
      await canTeamStartInstance(redis, mockDb, teamId, 'chall-1', maxInstances)
    ).toBe(true)

    // Stop chall-1
    await recordInstanceStopped(redis, teamId, 'chall-1')

    // Now chall-3 should be allowed
    expect(
      await canTeamStartInstance(redis, mockDb, teamId, 'chall-3', maxInstances)
    ).toBe(true)
  })

  test('prunes expired instances when checking limit', async () => {
    const redis = new RedisMock() as unknown as TypedRedis
    const mockDb = {} as any
    const teamId = 'team-expired-1'
    const key = teamInstancesKey(teamId)

    // Add an expired instance (timestamp in past)
    await redis.zadd(key, Date.now() - 5000, 'chall-old')
    await recordInstanceStarted(redis, teamId, 'chall-active', 60000)

    // Max instances = 2
    // With 1 expired and 1 active, can start a new one
    expect(
      await canTeamStartInstance(redis, mockDb, teamId, 'chall-new', 2)
    ).toBe(true)

    // The expired one should have been removed
    const oldScore = await redis.zscore(key, 'chall-old')
    expect(oldScore).toBeNull()
  })

  test('syncInstanceStatus updates Redis on stopped or running', async () => {
    const redis = new RedisMock() as unknown as TypedRedis
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
})
