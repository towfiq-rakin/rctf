import { config } from '@rctf/config'
import {
  BadInstancerError,
  BadTooManyInstances,
  GoodChallengeUpdateV2,
  GoodInstanceStatus,
  InstanceStatus,
  Permissions,
} from '@rctf/types'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Hono } from 'hono'
import {
  teamInstancesInitializedKey,
  teamInstancesKey,
} from '../../../../apps/api/src/cache/instance-limiter'
import { createToken, TokenKind } from '../../../../apps/api/src/lib/tokens'
import {
  instancers,
  setInstancerEnabled,
} from '../../../../apps/api/src/providers/instances/instancer'
import {
  InstancerProvider,
  type CreateInstanceOptions,
  type ExtendInstanceOptions,
  type InstanceQueryOptions,
} from '../../../../apps/api/src/providers/instancer/base'
import { createRedis } from '../../../../apps/api/src/util/redis'
import { getApp, request } from '../../app'
import { expectResponse, generateRealTestUser } from '../../util'

class TestInstancerProvider extends InstancerProvider {
  readonly configSchema = {
    safeParse: (data: any) => ({ success: true, data }),
  } as any
  readonly capabilities = { canStop: true, canExtend: true }
  getDefaults = () => ({})
  private runningInstances = new Set<string>()
  private deleteErrors = new Set<string>()
  private getErrors = new Set<string>()
  private createDelayMilliseconds = 0

  seedRunning = (teamId: string, challengeIntegrationId: string) => {
    this.runningInstances.add(`${teamId}:${challengeIntegrationId}`)
  }

  clearRunning = (teamId: string, challengeIntegrationId: string) => {
    this.runningInstances.delete(`${teamId}:${challengeIntegrationId}`)
  }

  setCreateDelay = (delayMilliseconds: number) => {
    this.createDelayMilliseconds = delayMilliseconds
  }

  setGetError = (
    teamId: string,
    challengeIntegrationId: string,
    enabled: boolean
  ) => {
    const key = `${teamId}:${challengeIntegrationId}`
    if (enabled) {
      this.getErrors.add(key)
    } else {
      this.getErrors.delete(key)
    }
  }

  setDeleteError = (
    teamId: string,
    challengeIntegrationId: string,
    enabled: boolean
  ) => {
    const key = `${teamId}:${challengeIntegrationId}`
    if (enabled) {
      this.deleteErrors.add(key)
    } else {
      this.deleteErrors.delete(key)
    }
  }

  createInstance = async (options: CreateInstanceOptions) => {
    await Bun.sleep(this.createDelayMilliseconds)
    this.runningInstances.add(
      `${options.user.id}:${options.challengeIntegrationId}`
    )
    return {
      kind: 'instancerInstanceDetails' as const,
      status: InstanceStatus.RUNNING,
      timeLeftMilliseconds: options.timeoutMilliseconds,
      endpoints: [],
    }
  }

  getInstance = async (options: InstanceQueryOptions) => {
    const key = `${options.teamId}:${options.challengeIntegrationId}`
    if (this.getErrors.has(key)) {
      return {
        kind: 'instancerError' as const,
        message: 'temporary status failure',
      }
    }

    const isRunning = this.runningInstances.has(key)
    return {
      kind: 'instancerInstanceDetails' as const,
      status: isRunning ? InstanceStatus.RUNNING : InstanceStatus.STOPPED,
      timeLeftMilliseconds: isRunning ? 60000 : null,
      endpoints: isRunning ? [] : null,
    }
  }

  deleteInstance = async (options: InstanceQueryOptions) => {
    const key = `${options.teamId}:${options.challengeIntegrationId}`
    if (this.deleteErrors.has(key)) {
      return {
        kind: 'instancerError' as const,
        message: 'temporary delete failure',
      }
    }

    this.runningInstances.delete(key)
    return {
      kind: 'instancerInstanceDetails' as const,
      status: InstanceStatus.STOPPED,
      timeLeftMilliseconds: null,
      endpoints: null,
    }
  }

  extendInstance = async (options: ExtendInstanceOptions) => {
    return {
      kind: 'instancerInstanceDetails' as const,
      status: InstanceStatus.RUNNING,
      timeLeftMilliseconds: options.timeoutMilliseconds,
      endpoints: [],
    }
  }
}

let app: Hono<any>
let userData: Awaited<ReturnType<typeof generateRealTestUser>>
let adminData: Awaited<ReturnType<typeof generateRealTestUser>>
let chall1Id: string
let chall2Id: string
let chall3Id: string
let testProvider: TestInstancerProvider

beforeAll(async () => {
  app = await getApp()
  userData = await generateRealTestUser()
  adminData = await generateRealTestUser(
    Permissions.challsRead | Permissions.challsWrite
  )

  testProvider = new TestInstancerProvider({})
  instancers['mock-provider'] = testProvider
  setInstancerEnabled(true)

  const adminToken = await createToken(TokenKind.Auth, adminData.user.id)

  const createChallenge = async (name: string, integrationId: string) => {
    const id = crypto.randomUUID()
    const res = await request(app, `/api/v2/admin/challs/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        data: {
          name,
          description: `Description for ${name}`,
          category: 'pwn',
          author: 'tester',
          points: { min: 100, max: 500 },
          flags: [{ config: { flag: `flag{${name}}` } }],
          instancerConfig: {
            challengeIntegrationId: integrationId,
            instancer: 'mock-provider',
            timeoutMilliseconds: 60000,
            extendable: true,
            config: {},
            expose: [],
          },
        },
      }),
    })
    await expectResponse(res, GoodChallengeUpdateV2)
    return id
  }

  chall1Id = await createChallenge('Chall 1', 'chall-1-int')
  chall2Id = await createChallenge('Chall 2', 'chall-2-int')
  chall3Id = await createChallenge('Chall 3', 'chall-3-int')
})

afterAll(async () => {
  delete instancers['mock-provider']
  setInstancerEnabled(Object.keys(instancers).length > 0)
  await userData.cleanup()
  await adminData.cleanup()
})

describe('instancer maxInstances limiter integration', () => {
  test('atomically enforces the limit for concurrent starts', async () => {
    config.maxInstances = 1
    const testUser = await generateRealTestUser()

    try {
      const userToken = await createToken(TokenKind.Auth, testUser.user.id)
      testProvider.setCreateDelay(50)
      const responses = await Promise.all(
        [chall1Id, chall2Id].map(challId =>
          request(app, `/api/v2/integrations/challs/${challId}/instance`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          })
        )
      )

      expect(responses.map(response => response.status).sort()).toEqual([
        200, 409,
      ])
    } finally {
      testProvider.setCreateDelay(0)
      testProvider.clearRunning(testUser.user.id, 'chall-1-int')
      testProvider.clearRunning(testUser.user.id, 'chall-2-int')
      config.maxInstances = undefined
      await testUser.cleanup()
    }
  })

  test('reconciles running provider instances when limiter state is missing', async () => {
    config.maxInstances = 1
    const testUser = await generateRealTestUser()

    try {
      const userToken = await createToken(TokenKind.Auth, testUser.user.id)
      testProvider.seedRunning(testUser.user.id, 'chall-1-int')

      const redis = await createRedis()
      await redis.del(
        teamInstancesKey(testUser.user.id),
        teamInstancesInitializedKey(testUser.user.id)
      )

      const res = await request(
        app,
        `/api/v2/integrations/challs/${chall2Id}/instance`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )
      await expectResponse(res, BadTooManyInstances)
    } finally {
      testProvider.clearRunning(testUser.user.id, 'chall-1-int')
      config.maxInstances = undefined
      await testUser.cleanup()
    }
  })

  test('fails closed when initial provider reconciliation is unavailable', async () => {
    config.maxInstances = 1
    const testUser = await generateRealTestUser()

    try {
      const userToken = await createToken(TokenKind.Auth, testUser.user.id)
      testProvider.setGetError(testUser.user.id, 'chall-1-int', true)

      const res = await request(
        app,
        `/api/v2/integrations/challs/${chall2Id}/instance`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )
      await expectResponse(res, BadInstancerError)
    } finally {
      testProvider.setGetError(testUser.user.id, 'chall-1-int', false)
      config.maxInstances = undefined
      await testUser.cleanup()
    }
  })

  test('keeps the slot when the provider fails to delete an instance', async () => {
    config.maxInstances = 1
    const testUser = await generateRealTestUser()

    try {
      const userToken = await createToken(TokenKind.Auth, testUser.user.id)
      let res = await request(
        app,
        `/api/v2/integrations/challs/${chall1Id}/instance`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )
      await expectResponse(res, GoodInstanceStatus)

      testProvider.setDeleteError(testUser.user.id, 'chall-1-int', true)
      res = await request(
        app,
        `/api/v2/integrations/challs/${chall1Id}/instance`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${userToken}` },
        }
      )
      await expectResponse(res, BadInstancerError)

      res = await request(
        app,
        `/api/v2/integrations/challs/${chall2Id}/instance`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )
      await expectResponse(res, BadTooManyInstances)
    } finally {
      testProvider.setDeleteError(testUser.user.id, 'chall-1-int', false)
      testProvider.clearRunning(testUser.user.id, 'chall-1-int')
      config.maxInstances = undefined
      await testUser.cleanup()
    }
  })

  test('enforces maxInstances limit on PUT /instance and allows after DELETE', async () => {
    config.maxInstances = 2
    const userToken = await createToken(TokenKind.Auth, userData.user.id)

    // 1. Start Chall 1 -> Success
    let res = await request(
      app,
      `/api/v2/integrations/challs/${chall1Id}/instance`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )
    let body = await expectResponse(res, GoodInstanceStatus)
    expect(body.data.status).toBe(InstanceStatus.RUNNING)

    // 2. Start Chall 2 -> Success
    res = await request(
      app,
      `/api/v2/integrations/challs/${chall2Id}/instance`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )
    body = await expectResponse(res, GoodInstanceStatus)
    expect(body.data.status).toBe(InstanceStatus.RUNNING)

    // 3. Start Chall 3 -> Reached limit of 2 -> 409 badTooManyInstances
    res = await request(
      app,
      `/api/v2/integrations/challs/${chall3Id}/instance`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )
    await expectResponse(res, BadTooManyInstances)

    // 4. Starting Chall 1 again (same challenge) -> Allowed
    res = await request(
      app,
      `/api/v2/integrations/challs/${chall1Id}/instance`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )
    body = await expectResponse(res, GoodInstanceStatus)
    expect(body.data.status).toBe(InstanceStatus.RUNNING)

    // 5. Stop Chall 1
    res = await request(
      app,
      `/api/v2/integrations/challs/${chall1Id}/instance`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      }
    )
    body = await expectResponse(res, GoodInstanceStatus)
    expect(body.data.status).toBe(InstanceStatus.STOPPED)

    // 6. Start Chall 3 -> Now allowed since only Chall 2 is active
    res = await request(
      app,
      `/api/v2/integrations/challs/${chall3Id}/instance`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )
    body = await expectResponse(res, GoodInstanceStatus)
    expect(body.data.status).toBe(InstanceStatus.RUNNING)

    // Reset config
    config.maxInstances = undefined
  })

  test('allows unlimited instances when maxInstances is not configured', async () => {
    config.maxInstances = undefined
    const userToken = await createToken(TokenKind.Auth, userData.user.id)

    // Can start Chall 1, 2, 3 without limits
    for (const challId of [chall1Id, chall2Id, chall3Id]) {
      const res = await request(
        app,
        `/api/v2/integrations/challs/${challId}/instance`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      )
      const body = await expectResponse(res, GoodInstanceStatus)
      expect(body.data.status).toBe(InstanceStatus.RUNNING)
    }

    // Clean up
    for (const challId of [chall1Id, chall2Id, chall3Id]) {
      await request(app, `/api/v2/integrations/challs/${challId}/instance`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userToken}` },
      })
    }
  })

  test('handles PATCH /instance extend properly with maxInstances', async () => {
    config.maxInstances = 1
    const userToken = await createToken(TokenKind.Auth, userData.user.id)

    // Start Chall 1
    let res = await request(
      app,
      `/api/v2/integrations/challs/${chall1Id}/instance`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )
    await expectResponse(res, GoodInstanceStatus)

    // Extend Chall 1
    res = await request(
      app,
      `/api/v2/integrations/challs/${chall1Id}/instance`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )
    const body = await expectResponse(res, GoodInstanceStatus)
    expect(body.data.status).toBe(InstanceStatus.RUNNING)

    // Cannot start Chall 2
    res = await request(
      app,
      `/api/v2/integrations/challs/${chall2Id}/instance`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )
    await expectResponse(res, BadTooManyInstances)

    // Clean up
    await request(app, `/api/v2/integrations/challs/${chall1Id}/instance`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}` },
    })
    config.maxInstances = undefined
  })
})
