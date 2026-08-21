import type { DatabaseClient } from '@rctf/db'
import type { instanceDetailsOrError } from '../providers/instancer/base'
import { getChallenge } from '../services/challenges'
import {
  getInstancerProvider,
  resolveInstancerName,
} from '../services/instancer'
import { inferChallengeIntegrationId } from '../util/instancer'
import type { TypedRedis } from './scripts'

export const teamInstancesKey = (teamId: string) =>
  `instancer:team_instances:${teamId}`

export const canTeamStartInstance = async (
  redis: TypedRedis,
  db: DatabaseClient,
  teamId: string,
  challengeId: string,
  maxInstances?: number
): Promise<boolean> => {
  if (!maxInstances || maxInstances <= 0) {
    return true
  }

  const key = teamInstancesKey(teamId)
  const now = Date.now()

  // 1. Prune expired entries
  await redis.zremrangebyscore(key, '-inf', now)

  // 2. Check if this challenge is already active for the team
  const score = await redis.zscore(key, challengeId)
  if (score !== null && Number(score) > now) {
    return true
  }

  // 3. Check active count
  let count = await redis.zcard(key)
  if (count < maxInstances) {
    return true
  }

  // 4. Double check running status with provider for candidate challenges
  if (db && typeof db.select === 'function') {
    const activeChallIds = await redis.zrange(key, 0, -1)
    for (const activeId of activeChallIds) {
      try {
        const chall = await getChallenge(db, activeId)
        if (!chall?.data.instancerConfig) {
          await redis.zrem(key, activeId)
          count--
          continue
        }

        const provider = getInstancerProvider(
          resolveInstancerName(chall.data.instancerConfig)
        )
        if (!provider) {
          await redis.zrem(key, activeId)
          count--
          continue
        }

        const status = await provider.getInstance({
          teamId,
          challengeIntegrationId: inferChallengeIntegrationId(chall),
          config: chall.data.instancerConfig.config,
        })

        if (
          status.kind !== 'instancerInstanceDetails' ||
          status.status === 'stopped' ||
          status.status === 'errored'
        ) {
          await redis.zrem(key, activeId)
          count--
        }
      } catch {
        // Keep on provider error to be safe
      }
    }
  }

  return count < maxInstances
}

export const recordInstanceStarted = async (
  redis: TypedRedis,
  teamId: string,
  challengeId: string,
  timeoutMilliseconds: number
): Promise<void> => {
  const key = teamInstancesKey(teamId)
  const expiresAt = Date.now() + timeoutMilliseconds
  await redis.zadd(key, expiresAt, challengeId)
  await redis.expire(
    key,
    Math.max(86400, Math.ceil((timeoutMilliseconds * 2) / 1000))
  )
}

export const recordInstanceStopped = async (
  redis: TypedRedis,
  teamId: string,
  challengeId: string
): Promise<void> => {
  const key = teamInstancesKey(teamId)
  await redis.zrem(key, challengeId)
}

export const recordInstanceExtended = async (
  redis: TypedRedis,
  teamId: string,
  challengeId: string,
  timeLeftMilliseconds: number
): Promise<void> => {
  const key = teamInstancesKey(teamId)
  const expiresAt = Date.now() + timeLeftMilliseconds
  await redis.zadd(key, expiresAt, challengeId)
}

export const syncInstanceStatus = async (
  redis: TypedRedis,
  teamId: string,
  challengeId: string,
  status: instanceDetailsOrError
): Promise<void> => {
  if (
    status.kind === 'instancerError' ||
    (status.kind === 'instancerInstanceDetails' &&
      (status.status === 'stopped' || status.status === 'errored'))
  ) {
    await recordInstanceStopped(redis, teamId, challengeId)
  } else if (
    status.kind === 'instancerInstanceDetails' &&
    status.status === 'running' &&
    status.timeLeftMilliseconds !== null
  ) {
    await recordInstanceExtended(
      redis,
      teamId,
      challengeId,
      status.timeLeftMilliseconds
    )
  }
}
