import { GetInstanceStatusRouteV2 } from '@rctf/types'
import { syncInstanceStatus } from '../../../../cache/instance-limiter'
import {
  filterInstanceEndpoints,
  getInstancerChallenge,
  returnInstanceStatusOrError,
} from '../../../../services/instancer'
import { inferChallengeIntegrationId } from '../../../../util/instancer'
import integrationsGroup from '../group'

integrationsGroup.route(
  GetInstanceStatusRouteV2,
  async ({ ctx, res, params, user }) => {
    const { challenge, provider, error } = await getInstancerChallenge(
      res,
      ctx.var.db,
      params.id
    )
    if (error) {
      return error
    }

    let instanceStatus = await provider.getInstance({
      teamId: user.id,
      challengeIntegrationId: inferChallengeIntegrationId(challenge),
      config: challenge.data.instancerConfig!.config,
    })

    await syncInstanceStatus(
      ctx.var.redis,
      user.id,
      challenge.id,
      instanceStatus
    )

    return await returnInstanceStatusOrError(
      res,
      filterInstanceEndpoints(instanceStatus, challenge)
    )
  }
)
