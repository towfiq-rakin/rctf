import type { Challenge, DatabaseClient } from '@rctf/db'
import type { instanceDetailsOrError } from '../providers/instancer/base'
import {
  getPrivateChallenge,
  getPrivateChallenges,
} from '../services/challenges'
import {
  getInstancerProvider,
  resolveInstancerName,
} from '../services/instancer'
import { inferChallengeIntegrationId } from '../util/instancer'
import type { TypedRedis } from './scripts'

const MINIMUM_LEASE_MILLISECONDS = 60_000
const RESERVATION_GRACE_MILLISECONDS = 60_000

export type InstanceReservation =
  | 'disabled'
  | 'unavailable'
  | 'limit'
  | 'existing'
  | 'reserved'

export const teamInstancesKey = (teamId: string) =>
  `instancer:team_instances:${teamId}`

export const teamInstancesInitializedKey = (teamId: string) =>
  `instancer:team_instances_initialized:${teamId}`

export const teamInstanceReservationsKey = (teamId: string) =>
  `instancer:team_instance_reservations:${teamId}`

const isActiveStatus = (status: instanceDetailsOrError): boolean =>
  status.kind === 'instancerInstanceDetails' &&
  (status.status === 'starting' ||
    status.status === 'running' ||
    status.status === 'stopping')

const leaseMilliseconds = (
  status: instanceDetailsOrError,
  fallbackMilliseconds: number
): number => {
  if (
    status.kind === 'instancerInstanceDetails' &&
    status.timeLeftMilliseconds !== null &&
    status.timeLeftMilliseconds > 0
  ) {
    return status.timeLeftMilliseconds
  }

  return Math.max(fallbackMilliseconds, MINIMUM_LEASE_MILLISECONDS)
}

export const reserveInstanceSlot = async (
  redis: TypedRedis,
  teamId: string,
  challengeId: string,
  maxInstances: number,
  timeoutMilliseconds: number
): Promise<'limit' | 'existing' | 'reserved'> => {
  const result = await redis.rctfReserveInstance(
    teamInstancesKey(teamId),
    teamInstanceReservationsKey(teamId),
    maxInstances.toString(),
    challengeId,
    Math.max(timeoutMilliseconds, MINIMUM_LEASE_MILLISECONDS).toString(),
    RESERVATION_GRACE_MILLISECONDS.toString()
  )

  if (result === 0) {
    return 'limit'
  }
  return result === 1 ? 'existing' : 'reserved'
}

export const recordInstanceStarted = async (
  redis: TypedRedis,
  teamId: string,
  challengeId: string,
  timeoutMilliseconds: number
): Promise<void> => {
  await redis.rctfUpdateInstance(
    teamInstancesKey(teamId),
    teamInstanceReservationsKey(teamId),
    challengeId,
    Math.max(timeoutMilliseconds, MINIMUM_LEASE_MILLISECONDS).toString()
  )
}

export const recordInstanceStopped = async (
  redis: TypedRedis,
  teamId: string,
  challengeId: string
): Promise<void> => {
  await Promise.all([
    redis.zrem(teamInstancesKey(teamId), challengeId),
    redis.zrem(teamInstanceReservationsKey(teamId), challengeId),
  ])
}

export const recordInstanceExtended = recordInstanceStarted

export const syncInstanceStatus = async (
  redis: TypedRedis,
  teamId: string,
  challengeId: string,
  status: instanceDetailsOrError,
  fallbackMilliseconds = MINIMUM_LEASE_MILLISECONDS
): Promise<'active' | 'terminal' | 'unavailable'> => {
  if (status.kind === 'instancerError') {
    return 'unavailable'
  }

  if (isActiveStatus(status)) {
    await recordInstanceStarted(
      redis,
      teamId,
      challengeId,
      leaseMilliseconds(status, fallbackMilliseconds)
    )
    return 'active'
  }

  await recordInstanceStopped(redis, teamId, challengeId)
  return 'terminal'
}

const reconcileChallenges = async (
  redis: TypedRedis,
  teamId: string,
  challenges: Challenge[],
  removeTerminal: boolean
): Promise<boolean> => {
  const results = await Promise.all(
    challenges.map(async challenge => {
      const instancerConfig = challenge.data.instancerConfig
      if (!instancerConfig) {
        return true
      }

      const provider = getInstancerProvider(
        resolveInstancerName(instancerConfig)
      )
      if (!provider) {
        return false
      }

      try {
        const status = await provider.getInstance({
          teamId,
          challengeIntegrationId: inferChallengeIntegrationId(challenge),
          config: instancerConfig.config,
        })
        if (status.kind === 'instancerError') {
          return false
        }
        if (!isActiveStatus(status) && !removeTerminal) {
          return true
        }

        await syncInstanceStatus(
          redis,
          teamId,
          challenge.id,
          status,
          instancerConfig.timeoutMilliseconds
        )
        return true
      } catch {
        return false
      }
    })
  )

  return results.every(Boolean)
}

export const initializeTeamInstances = async (
  redis: TypedRedis,
  db: DatabaseClient,
  teamId: string
): Promise<boolean> => {
  const initializedKey = teamInstancesInitializedKey(teamId)
  if (await redis.exists(initializedKey)) {
    return true
  }

  const reconciled = await reconcileChallenges(
    redis,
    teamId,
    await getPrivateChallenges(db),
    false
  )
  if (reconciled) {
    await redis.set(initializedKey, '1')
  }
  return reconciled
}

const reconcileTrackedInstances = async (
  redis: TypedRedis,
  db: DatabaseClient,
  teamId: string
): Promise<boolean> => {
  const challengeIds = await redis.zrange(teamInstancesKey(teamId), 0, -1)
  const reservations = new Set(
    await redis.zrange(teamInstanceReservationsKey(teamId), 0, -1)
  )
  const challenges = await Promise.all(
    challengeIds
      .filter(challengeId => !reservations.has(challengeId))
      .map(challengeId => getPrivateChallenge(db, challengeId))
  )

  if (challenges.some(challenge => challenge === undefined)) {
    return false
  }

  return await reconcileChallenges(
    redis,
    teamId,
    challenges as Challenge[],
    true
  )
}

export const requestInstanceReservation = async (
  redis: TypedRedis,
  db: DatabaseClient,
  teamId: string,
  challengeId: string,
  timeoutMilliseconds: number,
  maxInstances?: number
): Promise<InstanceReservation> => {
  if (maxInstances === undefined) {
    return 'disabled'
  }

  if (!(await initializeTeamInstances(redis, db, teamId))) {
    return 'unavailable'
  }

  let reservation = await reserveInstanceSlot(
    redis,
    teamId,
    challengeId,
    maxInstances,
    timeoutMilliseconds
  )
  if (reservation !== 'limit') {
    return reservation
  }

  if (!(await reconcileTrackedInstances(redis, db, teamId))) {
    return 'unavailable'
  }

  reservation = await reserveInstanceSlot(
    redis,
    teamId,
    challengeId,
    maxInstances,
    timeoutMilliseconds
  )
  return reservation
}
