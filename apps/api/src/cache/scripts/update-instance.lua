-- KEYS:
-- 1: team instances sorted set
-- 2: provisional reservations sorted set
--
-- ARGV:
-- 1: challenge ID
-- 2: lease duration (ms)

local key = KEYS[1]
local reservations_key = KEYS[2]
local challenge_id = ARGV[1]
local ttl_ms = tonumber(ARGV[2])

local time = redis.call('TIME')
local now = tonumber(time[1]) + tonumber(time[2]) / 1000000

redis.call('ZADD', key, now + ttl_ms / 1000, challenge_id)
redis.call('ZREM', reservations_key, challenge_id)
