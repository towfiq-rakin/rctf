<script lang="ts">
  import { page } from '$app/state'
  import type { Component } from 'svelte'

  type Props = {
    href?: string
    activePath?: string
    label: string
    icon: Component
    [key: string]: unknown
  }

  let { href, activePath, label, icon: Icon, ...rest }: Props = $props()

  const active = $derived.by(() => {
    if (!activePath) return false
    if (activePath === '/') return page.url.pathname === '/'
    return page.url.pathname.startsWith(activePath)
  })
</script>

{#if href}
  <a
    {href}
    aria-label={label}
    aria-current={active ? 'page' : undefined}
    data-active={active ? '' : undefined}
    {...rest}
  >
    <Icon />
  </a>
{:else}
  <button
    type="button"
    aria-label={label}
    data-active={active ? '' : undefined}
    {...rest}
  >
    <Icon />
  </button>
{/if}

<style>
  a,
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.75rem 1rem;
    font-size: 1.5rem;
    color: var(--foreground-l2);
    background: color-mix(in srgb, var(--background-l2) 65%, transparent);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    border: 1px solid light-dark(rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.08));
    border-radius: var(--radius-lg);
    box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.12);
    cursor: pointer;

    &:hover {
      background: color-mix(in srgb, var(--background-l3) 75%, transparent);
    }

    &[data-active] {
      color: var(--foreground-accent);
      background: color-mix(in srgb, var(--background-accent) 70%, transparent);

      &:hover {
        background: color-mix(in srgb, var(--background-accent-hover) 80%, transparent);
      }
    }

    :global(svg) {
      flex-shrink: 0;
    }
  }
</style>
