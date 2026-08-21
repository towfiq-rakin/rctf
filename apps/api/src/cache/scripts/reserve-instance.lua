-- KEYS:
-- 1: team instances sorted set
-- 2: provisional reservations sorted set
--
-- ARGV:
-- 1: maximum active instances
-- 2: challenge ID
-- 3: lease duration (ms)
-- 4: provisional reservation duration (ms)

local key = KEYS[1]
local reservations_key = KEYS[2]
local max_instances = tonumber(ARGV[1])
local challenge_id = ARGV[2]
local ttl_ms = tonumber(ARGV[3])
local reservation_ttl_ms = tonumber(ARGV[4])

local time = redis.call('TIME')
local now = tonumber(time[1]) + tonumber(time[2]) / 1000000

redis.call('ZREMRANGEBYSCORE', reservations_key, '-inf', now)

local score = redis.call('ZSCORE', key, challenge_id)
if score then
  return 1
end

if redis.call('ZCARD', key) >= max_instances then
  return 0
end

redis.call('ZADD', key, now + ttl_ms / 1000, challenge_id)
redis.call('ZADD', reservations_key, now + reservation_ttl_ms / 1000, challenge_id)
return 2
