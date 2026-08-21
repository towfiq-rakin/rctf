import { response } from '../internal'

export const BadTooManyInstances = response('badTooManyInstances', {
  status: 409,
  message: 'You have reached the maximum number of active challenge instances.',
})
