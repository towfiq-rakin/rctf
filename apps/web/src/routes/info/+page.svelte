<script lang="ts">
  import Markdown from '$lib/components/markdown.svelte'
  import Card from '$lib/ui/card.svelte'
  import type { PageProps } from './$types'

  const { data }: PageProps = $props()
</script>

<svelte:head>
  <title>Rules & Info | {data.clientConfig.ctfName}</title>
</svelte:head>

<info-page>
  <Card>
    <Markdown content={data.clientConfig.rulesContent} />
  </Card>
</info-page>

<style>
  info-page {
    display: block;
    inline-size: 100%;
    max-inline-size: calc(var(--measure) + 2rem);
    margin-inline: auto;
    padding-inline: 1rem;
    padding-block: var(--space-s);

    @media (width >= 48rem) {
      max-inline-size: calc(var(--measure) + 4.5rem);
      padding-inline: 2.25rem;
    }
  }
</style>
