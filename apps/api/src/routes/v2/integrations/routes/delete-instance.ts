import { DeleteInstanceRouteV2 } from '@rctf/types'
import { deleteInstance } from '../../../../services/instance-lifecycle'
import integrationsGroup from '../group'

integrationsGroup.route(DeleteInstanceRouteV2, ({ ctx, res, params, user }) =>
  deleteInstance({
    res,
    db: ctx.var.db,
    redis: ctx.var.redis,
    user,
    challengeId: params.id,
  })
)
