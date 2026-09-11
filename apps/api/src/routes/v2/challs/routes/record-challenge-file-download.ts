import { RecordChallengeFileDownloadRouteV2 } from '@rctf/types'
import {
  getPrivateChallenge,
  recordChallengeFileDownload,
} from '../../../../services/challenges'
import challsGroup from '../group'

challsGroup.route(
  RecordChallengeFileDownloadRouteV2,
  async ({ res, ctx, user, params }) => {
    const challenge = await getPrivateChallenge(ctx.var.db, params.id)

    if (!challenge) {
      return res.badChallenge()
    }

    if (challenge.data.files.length === 0) {
      return res.badChallenge()
    }

    await recordChallengeFileDownload(ctx.var.db, user.id, params.id)

    return res.goodChallengeFileDownload()
  }
)
