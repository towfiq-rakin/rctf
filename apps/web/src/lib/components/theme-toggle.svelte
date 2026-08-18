<script lang="ts">
  import { IconMoonStars, IconSun } from '$lib/icons'

  function toggle() {
    const root = document.documentElement
    const dark =
      root.dataset.theme === 'dark' ||
      (!root.dataset.theme &&
        matchMedia('(prefers-color-scheme: dark)').matches)
    const theme = dark ? 'light' : 'dark'
    root.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }
</script>

<button type="button" onclick={toggle} aria-label="Toggle theme">
  <sun-icon data-theme-visible="dark"><IconSun /></sun-icon>
  <moon-icon data-theme-visible="light"><IconMoonStars /></moon-icon>
</button>

<style>
  button {
    display: inline-flex;
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
  }
</style>
