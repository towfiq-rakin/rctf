import { config } from '@rctf/config'
import { CreateInstanceRouteV2 } from '@rctf/types'
import {
  canTeamStartInstance,
  recordInstanceStarted,
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

    const canStart = await canTeamStartInstance(
      ctx.var.redis,
      ctx.var.db,
      user.id,
      challenge.id,
      config.maxInstances
    )
    if (!canStart) {
      return res.badTooManyInstances()
    }

    const instanceStatus = await provider.createInstance(
      await buildCreateInstanceOptions(ctx.var.db, challenge, user)
    )

    if (
      instanceStatus.kind === 'instancerInstanceDetails' &&
      instanceStatus.status !== 'stopped' &&
      instanceStatus.status !== 'errored'
    ) {
      await recordInstanceStarted(
        ctx.var.redis,
        user.id,
        challenge.id,
        instanceStatus.timeLeftMilliseconds ??
          challenge.data.instancerConfig!.timeoutMilliseconds
      )
    }

    return await returnInstanceStatusOrError(
      res,
      filterInstanceEndpoints(instanceStatus, challenge)
    )
  }
)
