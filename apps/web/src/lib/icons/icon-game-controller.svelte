<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements'

  type Props = SVGAttributes<SVGSVGElement>

  let { ...rest }: Props = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="1em"
  height="1em"
  viewBox="0 0 256 256"
  fill="currentColor"
  {...rest}
>
  <path
    fill-rule="evenodd"
    d="M76 56h104c28 0 47 19 52 47l12 72c5 31-27 49-50 27l-33-34H95l-33 34c-23 22-55 4-50-27l12-72c5-28 24-47 52-47ZM76 88v16H60v16h16v16h16v-16h16v-16H92V88ZM180 100a8 8 0 1 0-16 0 8 8 0 1 0 16 0ZM204 124a8 8 0 1 0-16 0 8 8 0 1 0 16 0Z"
  />
</svg>
