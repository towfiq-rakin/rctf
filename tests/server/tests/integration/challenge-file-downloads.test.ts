import { config } from '@rctf/config'
import {
  challengeFileDownloads,
  challenges,
  createDatabase,
  submissions,
  type ChallengeData,
} from '@rctf/db'
import {
  BadChallenge,
  BadToken,
  GoodChallengeFileDownload,
  GoodFlag,
  SubmissionResult,
} from '@rctf/types'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { createToken, TokenKind } from '../../../../apps/api/src/lib/tokens'
import {
  deleteChallenge,
  hasDownloadedChallengeFile,
  recordChallengeFileDownload,
} from '../../../../apps/api/src/services/challenges'
import { getApp, request } from '../../app'
import { expectResponse, generateRealTestUser } from '../../util'

let app: Hono<any>
let user1: Awaited<ReturnType<typeof generateRealTestUser>>
let user2: Awaited<ReturnType<typeof generateRealTestUser>>
const getDb = () => createDatabase(config.database.sql).db

const createTestChallenge = async (files: { name: string; url: string }[] = []) => {
  const db = getDb()
  const id = crypto.randomUUID()
  const flag = `flag{${crypto.randomUUID()}}`

  const data: ChallengeData = {
    name: crypto.randomUUID(),
    description: 'Test challenge with files',
    category: 'misc',
    author: 'admin',
    files,
    flags: [{ provider: 'flags/static', config: { flag } }],
    tiebreakEligible: true,
    points: { min: 100, max: 500 },
  }

  await db.insert(challenges).values({ id, data })

  return {
    challenge: { id, ...data, flag },
    cleanup: async () => {
      await db.delete(submissions).where(eq(submissions.challengeId, id))
      await db.delete(challengeFileDownloads).where(eq(challengeFileDownloads.challengeId, id))
      await db.delete(challenges).where(eq(challenges.id, id))
    },
  }
}

beforeAll(async () => {
  app = await getApp()
  user1 = await generateRealTestUser()
  user2 = await generateRealTestUser()
})

afterAll(async () => {
  await user1.cleanup()
  await user2.cleanup()
})

describe('challenge file downloads', () => {
  test('fails without auth token', async () => {
    const chall = await createTestChallenge([
      { name: 'attachment.zip', url: 'https://r2.example.com/attachment.zip' },
    ])
    try {
      const res = await request(app, `/api/v2/challs/${chall.challenge.id}/file-download`, {
        method: 'POST',
      })
      await expectResponse(res, BadToken)
    } finally {
      await chall.cleanup()
    }
  })

  test('fails when challenge does not exist', async () => {
    const token = await createToken(TokenKind.Auth, user1.user.id)
    const res = await request(app, `/api/v2/challs/non-existent-chall-id/file-download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    await expectResponse(res, BadChallenge)
  })

  test('fails when challenge has no files', async () => {
    const chall = await createTestChallenge([])
    try {
      const token = await createToken(TokenKind.Auth, user1.user.id)
      const res = await request(app, `/api/v2/challs/${chall.challenge.id}/file-download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      await expectResponse(res, BadChallenge)
    } finally {
      await chall.cleanup()
    }
  })

  test('records download successfully and is idempotent', async () => {
    const chall = await createTestChallenge([
      { name: 'dist.zip', url: 'https://r2.example.com/dist.zip' },
    ])
    try {
      const db = getDb()
      const token = await createToken(TokenKind.Auth, user1.user.id)

      expect(await hasDownloadedChallengeFile(db, user1.user.id, chall.challenge.id)).toBe(false)

      const res1 = await request(app, `/api/v2/challs/${chall.challenge.id}/file-download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      await expectResponse(res1, GoodChallengeFileDownload)

      expect(await hasDownloadedChallengeFile(db, user1.user.id, chall.challenge.id)).toBe(true)

      // Repeated download should succeed and not create duplicate rows
      const res2 = await request(app, `/api/v2/challs/${chall.challenge.id}/file-download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      await expectResponse(res2, GoodChallengeFileDownload)

      const rows = await db
        .select()
        .from(challengeFileDownloads)
        .where(
          and(
            eq(challengeFileDownloads.userId, user1.user.id),
            eq(challengeFileDownloads.challengeId, chall.challenge.id)
          )
        )
      expect(rows.length).toBe(1)
    } finally {
      await chall.cleanup()
    }
  })

  test('records filesDownloaded = false on solve when user never downloaded files', async () => {
    const chall = await createTestChallenge([
      { name: 'chal.bin', url: 'https://r2.example.com/chal.bin' },
    ])
    try {
      const db = getDb()
      const token = await createToken(TokenKind.Auth, user1.user.id)

      // Submit correct flag without downloading
      const res = await request(
        app,
        `/api/v1/challs/${encodeURIComponent(chall.challenge.id)}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ flag: chall.challenge.flag }),
        }
      )
      await expectResponse(res, GoodFlag)

      const [sub] = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.userId, user1.user.id),
            eq(submissions.challengeId, chall.challenge.id)
          )
        )

      expect(sub).toBeDefined()
      expect(sub.result).toBe(SubmissionResult.CORRECT)
      expect(sub.details.filesDownloaded).toBe(false)
    } finally {
      await chall.cleanup()
    }
  })

  test('records filesDownloaded = true on solve when user downloaded files beforehand', async () => {
    const chall = await createTestChallenge([
      { name: 'chal.bin', url: 'https://r2.example.com/chal.bin' },
    ])
    try {
      const db = getDb()
      const token = await createToken(TokenKind.Auth, user1.user.id)

      // Record download
      const dlRes = await request(app, `/api/v2/challs/${chall.challenge.id}/file-download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      await expectResponse(dlRes, GoodChallengeFileDownload)

      // Submit correct flag
      const res = await request(
        app,
        `/api/v1/challs/${encodeURIComponent(chall.challenge.id)}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ flag: chall.challenge.flag }),
        }
      )
      await expectResponse(res, GoodFlag)

      const [sub] = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.userId, user1.user.id),
            eq(submissions.challengeId, chall.challenge.id)
          )
        )

      expect(sub).toBeDefined()
      expect(sub.result).toBe(SubmissionResult.CORRECT)
      expect(sub.details.filesDownloaded).toBe(true)
    } finally {
      await chall.cleanup()
    }
  })

  test('does not include filesDownloaded in details when challenge has no files', async () => {
    const chall = await createTestChallenge([])
    try {
      const db = getDb()
      const token = await createToken(TokenKind.Auth, user1.user.id)

      const res = await request(
        app,
        `/api/v1/challs/${encodeURIComponent(chall.challenge.id)}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ flag: chall.challenge.flag }),
        }
      )
      await expectResponse(res, GoodFlag)

      const [sub] = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.userId, user1.user.id),
            eq(submissions.challengeId, chall.challenge.id)
          )
        )

      expect(sub).toBeDefined()
      expect(sub.result).toBe(SubmissionResult.CORRECT)
      expect(sub.details.filesDownloaded).toBeUndefined()
    } finally {
      await chall.cleanup()
    }
  })

  test('snapshot behavior: downloading after solving does not modify prior submission details', async () => {
    const chall = await createTestChallenge([
      { name: 'source.c', url: 'https://r2.example.com/source.c' },
    ])
    try {
      const db = getDb()
      const token = await createToken(TokenKind.Auth, user1.user.id)

      // Solve first without downloading
      const solveRes = await request(
        app,
        `/api/v1/challs/${encodeURIComponent(chall.challenge.id)}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ flag: chall.challenge.flag }),
        }
      )
      await expectResponse(solveRes, GoodFlag)

      // Later, user clicks download
      const dlRes = await request(app, `/api/v2/challs/${chall.challenge.id}/file-download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      await expectResponse(dlRes, GoodChallengeFileDownload)

      // Check that existing submission record still says filesDownloaded = false
      const [sub] = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.userId, user1.user.id),
            eq(submissions.challengeId, chall.challenge.id)
          )
        )

      expect(sub).toBeDefined()
      expect(sub.details.filesDownloaded).toBe(false)
    } finally {
      await chall.cleanup()
    }
  })

  test('deleteChallenge cleans up challenge_file_downloads', async () => {
    const chall = await createTestChallenge([
      { name: 'binary', url: 'https://r2.example.com/binary' },
    ])
    const db = getDb()
    await recordChallengeFileDownload(db, user1.user.id, chall.challenge.id)
    await recordChallengeFileDownload(db, user2.user.id, chall.challenge.id)

    expect(await hasDownloadedChallengeFile(db, user1.user.id, chall.challenge.id)).toBe(true)
    expect(await hasDownloadedChallengeFile(db, user2.user.id, chall.challenge.id)).toBe(true)

    await deleteChallenge(db, chall.challenge.id)

    expect(await hasDownloadedChallengeFile(db, user1.user.id, chall.challenge.id)).toBe(false)
    expect(await hasDownloadedChallengeFile(db, user2.user.id, chall.challenge.id)).toBe(false)
  })
})
