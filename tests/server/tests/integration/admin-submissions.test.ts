import { config } from '@rctf/config'
import { challenges, createDatabase, submissions, users } from '@rctf/db'
import {
  BadBody,
  BadFlag,
  BadPerms,
  GoodAdminSubmissions,
  GoodFlag,
  Permissions,
  SubmissionKind,
  SubmissionResult,
  SubmissionTeamStatus,
} from '@rctf/types'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { getFlagsForTeam } from '../../../../apps/api/src/providers/flags'
import { getApp, request } from '../../app'
import {
  clearDatabase,
  expectResponse,
  generateAuthToken,
  generateChallenge,
  generateRealTestUser,
} from '../../util'

let app: Hono<any>
const getDb = () => createDatabase(config.database.sql).db

beforeAll(async () => {
  app = await getApp()
})

beforeEach(async () => {
  await clearDatabase()
})

const adminAuth = async (
  perms = Permissions.usersWrite | Permissions.challsRead
) => {
  const admin = await generateRealTestUser(perms)
  return {
    admin,
    token: await generateAuthToken(admin.user.id),
  }
}

const filterSubmissions = (
  token: string,
  body: Record<string, unknown>,
  query = ''
) =>
  request(app, `/api/v2/admin/submissions?limit=100&offset=0${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

describe('admin submissions', () => {
  for (const method of ['GET', 'POST'] as const) {
    test(`${method} finds shared IP teams across all history, independently of filters and pagination`, async () => {
      const db = getDb()
      const { token } = await adminAuth()
      const alpha = await generateRealTestUser()
      const beta = await generateRealTestUser()
      const deleted = await generateRealTestUser()
      await db
        .update(users)
        .set({ name: 'Alpha Team' })
        .where(eq(users.id, alpha.user.id))
      await db
        .update(users)
        .set({ name: 'Beta Team', banned: true })
        .where(eq(users.id, beta.user.id))

      const insert = async (
        userId: string,
        ip: string,
        result = SubmissionResult.INCORRECT,
        kind = SubmissionKind.FLAG,
        createdAt = '2026-05-05T10:00:00.000Z'
      ) => {
        const id = crypto.randomUUID()
        await db.insert(submissions).values({
          id,
          userId,
          ip,
          result,
          kind,
          challengeId: 'history',
          createdAt,
        })
        return id
      }
      const sharedIp = '203.0.113.7'
      for (const result of Object.values(SubmissionResult)) {
        await insert(beta.user.id, sharedIp, result, SubmissionKind.ADMIN_BOT)
      }
      await insert(deleted.user.id, sharedIp)
      await db.delete(users).where(eq(users.id, deleted.user.id))
      const latestId = await insert(
        alpha.user.id,
        sharedIp,
        SubmissionResult.CORRECT,
        SubmissionKind.FLAG,
        '2026-05-06T10:00:00.000Z'
      )
      await insert(alpha.user.id, sharedIp)
      for (const ip of ['unknown', '', '   ', '203.0.113.8', '2001:db8::1']) {
        await insert(alpha.user.id, ip)
        await insert(alpha.user.id, ip)
      }
      for (const ip of ['unknown', '', '   ', '2001:db8::1']) {
        await insert(beta.user.id, ip)
      }
      await insert(beta.user.id, '2001:0db8::1')

      const fetchRows = async (
        query: string,
        body: Record<string, unknown> = {}
      ) =>
        expectResponse(
          await request(app, `/api/v2/admin/submissions?${query}`, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(method === 'POST'
                ? { 'Content-Type': 'application/json' }
                : {}),
            },
            ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
          }),
          GoodAdminSubmissions
        )

      const expected = [
        { id: beta.user.id, name: 'Beta Team' },
        { id: deleted.user.id, name: deleted.user.id },
      ].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      const page = await fetchRows(
        'limit=1&offset=0&teamSearch=Alpha&sortOrder=desc',
        {
          team: { include: [alpha.user.id] },
          kind: { include: [SubmissionKind.FLAG] },
          result: { include: [SubmissionResult.CORRECT] },
          teamStatus: { include: [SubmissionTeamStatus.NOT_BANNED] },
          createdAfter: '2026-05-06T00:00:00.000Z',
        }
      )
      expect(page.data.submissions).toHaveLength(1)
      expect(page.data.submissions[0]).toMatchObject({
        id: latestId,
        sharedIpTeams: expected,
      })

      const all = await fetchRows('limit=100&offset=0')
      for (const row of all.data.submissions) {
        if (row.ip === sharedIp) {
          const teams = [{ id: alpha.user.id, name: 'Alpha Team' }, ...expected]
            .filter(team => team.id !== row.userId)
            .sort(
              (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
            )
          expect(row.sharedIpTeams).toEqual(teams)
        } else if (row.ip === '2001:db8::1') {
          expect(row.sharedIpTeams).toEqual(
            row.userId === alpha.user.id
              ? [{ id: beta.user.id, name: 'Beta Team' }]
              : [{ id: alpha.user.id, name: 'Alpha Team' }]
          )
        } else {
          expect(row.sharedIpTeams).toEqual([])
        }
      }
      const empty = await fetchRows('limit=1&offset=1000')
      expect(empty.data.submissions).toEqual([])
      expect(empty.data.total).toBe(all.data.total)
    })
  }

  test('records flag submission IPs and returns them sortable by team', async () => {
    const db = getDb()
    const { admin } = await adminAuth()
    const alpha = await generateRealTestUser()
    const beta = await generateRealTestUser()
    const alphaChallenge = await generateChallenge()
    const betaChallenge = await generateChallenge()
    const divisions = Object.keys(config.divisions)
    const alphaDivision = divisions[0]!
    const betaDivision = divisions[1] ?? alphaDivision
    const { id: _alphaChallengeId, ...alphaChallengeData } =
      alphaChallenge.challenge
    const { id: _betaChallengeId, ...betaChallengeData } =
      betaChallenge.challenge

    await db
      .update(users)
      .set({ name: 'Alpha Team', division: alphaDivision })
      .where(eq(users.id, alpha.user.id))
    await db
      .update(users)
      .set({ name: 'Beta Team', division: betaDivision })
      .where(eq(users.id, beta.user.id))
    await db
      .update(challenges)
      .set({
        data: {
          ...alphaChallengeData,
          name: 'Alpha Challenge',
          category: 'web',
        },
      })
      .where(eq(challenges.id, alphaChallenge.challenge.id))
    await db
      .update(challenges)
      .set({
        data: {
          ...betaChallengeData,
          name: 'Beta Challenge',
          category: 'crypto',
        },
      })
      .where(eq(challenges.id, betaChallenge.challenge.id))

    const alphaToken = await generateAuthToken(alpha.user.id)
    const betaToken = await generateAuthToken(beta.user.id)

    const goodRes = await request(
      app,
      `/api/v1/challs/${alphaChallenge.challenge.id}/submit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alphaToken}`,
        },
        body: JSON.stringify({ flag: alphaChallenge.challenge.flag }),
      }
    )
    await expectResponse(goodRes, GoodFlag)

    const badRes = await request(
      app,
      `/api/v1/challs/${betaChallenge.challenge.id}/submit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${betaToken}`,
        },
        body: JSON.stringify({ flag: 'wrong' }),
      }
    )
    await expectResponse(badRes, BadFlag)

    await db
      .update(users)
      .set({ banned: true })
      .where(eq(users.id, beta.user.id))
    await db
      .update(submissions)
      .set({ createdAt: '2026-05-05T10:00:00.000Z' })
      .where(eq(submissions.userId, alpha.user.id))
    await db
      .update(submissions)
      .set({ createdAt: '2026-05-05T11:00:00.000Z' })
      .where(eq(submissions.userId, beta.user.id))

    const storedSubmissions = await db.select().from(submissions)
    expect(storedSubmissions).toHaveLength(2)
    expect(
      storedSubmissions.every(submission => submission.ip === '127.0.0.1')
    ).toBe(true)
    expect(
      storedSubmissions.map(submission => submission.details)
    ).toContainEqual({
      submittedFlag: alphaChallenge.challenge.flag,
      matchedFlagIndex: 0,
      matchedFlagProvider: 'flags/static',
      matchedFlagConfig: { flag: alphaChallenge.challenge.flag },
    })
    expect(
      storedSubmissions.map(submission => submission.details)
    ).toContainEqual({
      submittedFlag: 'wrong',
    })

    const token = await generateAuthToken(admin.user.id)

    const res = await request(
      app,
      '/api/v2/admin/submissions?limit=100&offset=0&sortBy=team&sortOrder=asc',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )
    const body = await expectResponse(res, GoodAdminSubmissions)
    expect(body.data.total).toBe(2)
    expect(
      body.data.submissions.map((submission: any) => submission.userName)
    ).toEqual(['Alpha Team', 'Beta Team'])
    expect(body.data.submissions[0]).toMatchObject({
      kind: SubmissionKind.FLAG,
      result: SubmissionResult.CORRECT,
      challengeName: 'Alpha Challenge',
      ip: '127.0.0.1',
      details: { submittedFlag: alphaChallenge.challenge.flag },
    })
    expect(body.data.submissions[1]).toMatchObject({
      kind: SubmissionKind.FLAG,
      result: SubmissionResult.INCORRECT,
      challengeName: 'Beta Challenge',
      ip: '127.0.0.1',
      details: { submittedFlag: 'wrong' },
    })

    const excludedRes = await filterSubmissions(token, {
      result: { exclude: [SubmissionResult.INCORRECT] },
    })
    const excludedBody = await expectResponse(excludedRes, GoodAdminSubmissions)
    expect(excludedBody.data.total).toBe(1)
    expect(
      excludedBody.data.submissions.map((submission: any) => submission.result)
    ).toEqual([SubmissionResult.CORRECT])

    const statusRes = await filterSubmissions(token, {
      teamStatus: { include: [SubmissionTeamStatus.BANNED] },
    })
    const statusBody = await expectResponse(statusRes, GoodAdminSubmissions)
    expect(
      statusBody.data.submissions.map((submission: any) => submission.userName)
    ).toEqual(['Beta Team'])

    const scopedRes = await filterSubmissions(token, {
      category: { include: ['web'] },
      division: { include: [alphaDivision] },
      createdAfter: '2026-05-05T09:30:00.000Z',
      createdBefore: '2026-05-05T10:30:00.000Z',
    })
    const scopedBody = await expectResponse(scopedRes, GoodAdminSubmissions)
    expect(
      scopedBody.data.submissions.map((submission: any) => submission.userName)
    ).toEqual(['Alpha Team'])
    expect(scopedBody.data.total).toBe(1)
  })

  test('surfaces cheated submissions with attribution and filtering', async () => {
    const db = getDb()
    const { admin } = await adminAuth()
    const owner = await generateRealTestUser()
    const thief = await generateRealTestUser()
    await db
      .update(users)
      .set({ name: 'Flag Donors' })
      .where(eq(users.id, owner.user.id))

    const challengeId = crypto.randomUUID()
    const dynamicEntry = {
      provider: 'flags/dynamic',
      config: { base: 'rctf{abcdefghijklmnopqrstuvwxyz}', mode: 'auto' },
    }
    await db.insert(challenges).values({
      id: challengeId,
      data: {
        name: 'Dynamic Challenge',
        description: 'desc',
        category: 'misc',
        author: 'tester',
        files: [],
        flags: [dynamicEntry],
        tiebreakEligible: true,
        points: { min: 100, max: 500 },
      },
    })

    const minted = await getFlagsForTeam([dynamicEntry], {
      db,
      teamId: owner.user.id,
      challengeId,
    })
    const ownerFlag = minted[0]!.flag

    const submitFlag = async (userId: string) => {
      const submitToken = await generateAuthToken(userId)
      const res = await request(app, `/api/v1/challs/${challengeId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${submitToken}`,
        },
        body: JSON.stringify({ flag: ownerFlag }),
      })
      await expectResponse(res, GoodFlag)
    }
    await submitFlag(owner.user.id)
    await submitFlag(thief.user.id)

    const token = await generateAuthToken(admin.user.id)
    const allBody = await expectResponse(
      await filterSubmissions(token, {}),
      GoodAdminSubmissions
    )
    expect(allBody.data.total).toBe(2)
    const rows = allBody.data.submissions as any[]
    expect(rows.find(row => row.userId === thief.user.id)).toMatchObject({
      result: SubmissionResult.CHEATED,
      cheatedFromId: owner.user.id,
      cheatedFromName: 'Flag Donors',
    })
    expect(rows.find(row => row.userId === owner.user.id)).toMatchObject({
      result: SubmissionResult.CORRECT,
      cheatedFromId: null,
      cheatedFromName: null,
    })

    const cheatedBody = await expectResponse(
      await filterSubmissions(token, {
        result: { include: [SubmissionResult.CHEATED] },
      }),
      GoodAdminSubmissions
    )
    expect(cheatedBody.data.total).toBe(1)
    expect(cheatedBody.data.submissions[0]!.userId).toBe(thief.user.id)

    const cleanBody = await expectResponse(
      await filterSubmissions(token, {
        result: { exclude: [SubmissionResult.CHEATED] },
      }),
      GoodAdminSubmissions
    )
    expect(cleanBody.data.total).toBe(1)
    expect(cleanBody.data.submissions[0]!.userId).toBe(owner.user.id)

    await db.delete(users).where(eq(users.id, owner.user.id))
    const orphanBody = await expectResponse(
      await filterSubmissions(token, {
        result: { include: [SubmissionResult.CHEATED] },
      }),
      GoodAdminSubmissions
    )
    expect(orphanBody.data.submissions[0]).toMatchObject({
      result: SubmissionResult.CHEATED,
      cheatedFromId: owner.user.id,
      cheatedFromName: null,
    })
  })

  test('requires team and challenge admin permissions', async () => {
    const { token } = await adminAuth(Permissions.challsRead)

    const res = await request(
      app,
      '/api/v2/admin/submissions?limit=10&offset=0',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )

    await expectResponse(res, BadPerms)
  })

  test('rejects invalid enum filters', async () => {
    const { token } = await adminAuth()

    const res = await filterSubmissions(token, {
      result: { include: [SubmissionResult.CORRECT, 'nope'] },
    })

    const body = await expectResponse(res, BadBody)
    expect(body.data.reason).toMatch(/^body:result\.include\.1:/)
  })

  test('rejects invalid date filters', async () => {
    const { token } = await adminAuth()

    const res = await filterSubmissions(token, {
      createdAfter: 'nope',
    })

    const body = await expectResponse(res, BadBody)
    expect(body.data.reason).toBe('body:createdAfter: must be a valid date')
  })

  test('rejects createdAfter after createdBefore', async () => {
    const { token } = await adminAuth()

    const res = await filterSubmissions(token, {
      createdAfter: '2026-05-05T11:00:00.000Z',
      createdBefore: '2026-05-05T10:00:00.000Z',
    })

    const body = await expectResponse(res, BadBody)
    expect(body.data.reason).toBe(
      'body:createdAfter: must be before createdBefore'
    )
  })
})
