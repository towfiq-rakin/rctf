import { response } from '../internal'

export const GoodChallengeFileDownload = response(
  'goodChallengeFileDownload',
  {
    status: 200,
    message: 'Challenge file download recorded.',
  }
)
