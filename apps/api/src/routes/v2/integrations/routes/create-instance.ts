import { config } from '@rctf/config'
import { CreateInstanceRouteV2 } from '@rctf/types'
import {
  recordInstanceStopped,
  requestInstanceReservation,
  syncInstanceStatus,
} from '../../../../cache/instance-limiter'
import {
  buildCreateInstanceOptions,
  filterInstanceEndpoints,
  getInstancerChallenge,
  returnInstanceStatusOrError,
} from '../../../../services/instancer'
import integrationsGroup from '../group'

integrationsGroup.route(
  CreateInstanceRouteV2,
  async ({ ctx, res, params, user }) => {
    const { challenge, provider, error } = await getInstancerChallenge(
      res,
      ctx.var.db,
      params.id
    )
    if (error) {
      return error
    }

    const timeoutMilliseconds =
      challenge.data.instancerConfig!.timeoutMilliseconds
    const reservation = await requestInstanceReservation(
      ctx.var.redis,
      ctx.var.db,
      user.id,
      challenge.id,
      timeoutMilliseconds,
      config.maxInstances
    )
    if (reservation === 'limit') {
      return res.badTooManyInstances()
    }
    if (reservation === 'unavailable') {
      return res.badInstancerError({
        message: 'Could not verify the active instance limit',
      })
    }

    let instanceStatus
    try {
      instanceStatus = await provider.createInstance(
        await buildCreateInstanceOptions(ctx.var.db, challenge, user)
      )
    } catch (error) {
      if (reservation === 'reserved') {
        await recordInstanceStopped(ctx.var.redis, user.id, challenge.id)
      }
      throw error
    }

    const isExistingTerminal =
      reservation === 'existing' &&
      instanceStatus.kind === 'instancerInstanceDetails' &&
      (instanceStatus.status === 'stopped' ||
        instanceStatus.status === 'errored')
    if (reservation !== 'disabled' && !isExistingTerminal) {
      const synced = await syncInstanceStatus(
        ctx.var.redis,
        user.id,
        challenge.id,
        instanceStatus,
        timeoutMilliseconds
      )
      if (synced === 'unavailable' && reservation === 'reserved') {
        await recordInstanceStopped(ctx.var.redis, user.id, challenge.id)
      }
    }

    return await returnInstanceStatusOrError(
      res,
      filterInstanceEndpoints(instanceStatus, challenge)
    )
  }
)
