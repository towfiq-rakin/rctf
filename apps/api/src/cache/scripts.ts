import path from 'node:path'
import type Redis from 'ioredis'

type GraphWriteCommand = (
  updateKey: string,
  dataKey: string,
  fingerprintKey: string,
  cursorKey: string,
  sourceKey: string,
  lastSample: string,
  fingerprint: string,
  cursor: string,
  source: string,
  packedUpdates: string[]
) => Promise<void>

type ReserveInstanceCommand = (
  key: string,
  reservationsKey: string,
  maxInstances: string,
  challengeId: string,
  ttlMilliseconds: string,
  reservationTtlMilliseconds: string
) => Promise<0 | 1 | 2>

export type TypedRedis = Redis & {
  rctfMergeGraph: GraphWriteCommand
  rctfReplaceGraph: GraphWriteCommand
  rctfRateLimit: (key: string, limit: string, ttlMs: string) => Promise<number>
  rctfReserveInstance: ReserveInstanceCommand
  rctfUpdateInstance: (
    key: string,
    reservationsKey: string,
    challengeId: string,
    ttlMilliseconds: string
  ) => Promise<void>
  hmget(key: string, fields: string[]): Promise<(string | null)[]>
}

export const loadLuaCommands = async (redis: Redis): Promise<TypedRedis> => {
  const baseDir = path.resolve(import.meta.dir, './scripts')

  const loadLuaScript = async (name: string): Promise<string> => {
    return await Bun.file(path.join(baseDir, name)).text()
  }

  redis.defineCommand('rctfMergeGraph', {
    numberOfKeys: 5,
    lua: await loadLuaScript('set-graph.lua'),
  })
  redis.defineCommand('rctfReplaceGraph', {
    numberOfKeys: 5,
    lua: await loadLuaScript('replace-graph.lua'),
  })
  redis.defineCommand('rctfRateLimit', {
    numberOfKeys: 1,
    lua: await loadLuaScript('rate-limit.lua'),
  })
  redis.defineCommand('rctfReserveInstance', {
    numberOfKeys: 2,
    lua: await loadLuaScript('reserve-instance.lua'),
  })
  redis.defineCommand('rctfUpdateInstance', {
    numberOfKeys: 2,
    lua: await loadLuaScript('update-instance.lua'),
  })

  return redis as TypedRedis
}
