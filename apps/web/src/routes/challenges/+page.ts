import { challengesQueryOptions } from '$lib/query/challenges'
import { userSelfQueryOptions } from '$lib/query/user'
import type { PageLoad } from './$types'

export const load: PageLoad = async ({ parent }) => {
  const { queryClient, clientConfig } = await parent()
  const user = queryClient.getQueryData(userSelfQueryOptions.queryKey)

  if (!clientConfig.challengesRequireAuth || user) {
    await queryClient.prefetchQuery(challengesQueryOptions)
  }
}
