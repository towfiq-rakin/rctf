<script lang="ts">
  import Markdown from '$lib/components/markdown.svelte'
  import ParticleText from '$lib/components/particletext.svelte';
  import Card from '$lib/ui/card.svelte'
  import type { PageProps } from './$types'

  const { data }: PageProps = $props()
</script>

<div class="desktop-title">
  <ParticleText
    text="BUP CSE FEST 2026 CTF"
    color="#ff0000"
    fontSize="clamp(2rem, 14vw, 6rem)"
    fontWeight={600}
    pointerRepel={20}
    particleSize={2}
  />
</div>

<div class="mobile-title" aria-label="BUP CSE FEST 2026 CTF">
  <div class="mobile-title__line mobile-title__line--left">
    <ParticleText
      text="BUP"
      color="#ff0000"
      fontSize="clamp(2.5rem, 14vw, 4rem)"
      fontWeight={600}
      pointerRepel={20}
      particleSize={2}
      style={{ height: '5rem', minHeight: '5rem' }}
    />
  </div>
  <div class="mobile-title__line mobile-title__line--center">
    <ParticleText
      text="CSE FEST 2026"
      color="#ff0000"
      fontSize="clamp(2.5rem, 14vw, 4rem)"
      fontWeight={600}
      pointerRepel={20}
      particleSize={2}
      style={{ height: '5rem', minHeight: '5rem' }}
    />
  </div>
  <div class="mobile-title__line mobile-title__line--right">
    <ParticleText
      text="CTF"
      color="#ff0000"
      fontSize="clamp(2.5rem, 14vw, 4rem)"
      fontWeight={600}
      pointerRepel={20}
      particleSize={2}
      style={{ height: '5rem', minHeight: '5rem' }}
    />
  </div>
</div>
<home-page>
  <Card>
    <Markdown content={data.clientConfig.homeContent} />
  </Card>
  <!-- <Markdown content={data.clientConfig.homeContent} /> -->

  <!-- <h1> Hello World</h1> -->
  
  {#if data.clientConfig.sponsors.length > 0}
    <Card title="Sponsors">
      <sponsor-grid>
        {#each data.clientConfig.sponsors as sponsor (sponsor.name)}
          {@const lightIcon = sponsor.iconLight || sponsor.icon}
          {@const darkIcon = sponsor.iconDark}
          <svelte:element
            this={sponsor.url ? 'a' : 'article'}
            href={sponsor.url}
            target={sponsor.url ? '_blank' : undefined}
            rel={sponsor.url ? 'noopener noreferrer' : undefined}
          >
            {#if lightIcon || darkIcon}
              <sponsor-icon
                data-theme-visible="light"
                data-invert={lightIcon ? undefined : ''}
              >
                <img
                  src={lightIcon || darkIcon}
                  alt={sponsor.name}
                  loading="lazy"
                />
              </sponsor-icon>
              <sponsor-icon
                data-theme-visible="dark"
                data-invert={darkIcon ? undefined : ''}
              >
                <img
                  src={darkIcon || lightIcon}
                  alt={sponsor.name}
                  loading="lazy"
                />
              </sponsor-icon>
            {/if}
            <h3>{sponsor.name}</h3>
            <Markdown content={sponsor.description} />
          </svelte:element>
        {/each}
      </sponsor-grid>
    </Card>
  {/if}

  <footer>
    Powered by
    <a href="https://rctf.osec.io" target="_blank" rel="noopener noreferrer"
      >rCTF</a
    >
  </footer>
</home-page>

<style>
  .desktop-title {
    display: none;
  }

  .mobile-title {
    display: grid;
    gap: 0.25rem;
    inline-size: 100%;
    padding-inline: 1rem;
  }

  .mobile-title__line {
    inline-size: 100%;
  }

  .mobile-title__line--left {
    inline-size: 38%;
    justify-self: start;
  }

  .mobile-title__line--center {
    inline-size: 100%;
    justify-self: center;
  }

  .mobile-title__line--right {
    inline-size: 38%;
    justify-self: end;
  }

  @media (width >= 48rem) {
    .desktop-title {
      display: block;
    }

    .mobile-title {
      display: none;
    }
  }

  home-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
    inline-size: 100%;
    max-inline-size: calc(var(--measure) + 2rem);
    margin-inline: auto;
    padding-inline: 1rem;

    @media (width >= 48rem) {
      max-inline-size: calc(var(--measure) + 4.5rem);
      padding-inline: 2.25rem;
    }
  }

  sponsor-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-s);

    a,
    article {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      padding: var(--space-s);
      background: transparent;
    }

    a {
      text-decoration: none;
    }

    a:hover {
      opacity: 0.85;
    }

    sponsor-icon[data-invert] img {
      filter: invert(1);
    }

    img {
      inline-size: 100%;
      block-size: auto;
      max-block-size: 8rem;
      object-fit: contain;
      padding: var(--space-2xs);
    }

    h3 {
      font-size: var(--step-1);
      font-weight: var(--font-weight-medium);
    }
  }

  footer {
    padding-block: var(--space-s);
    text-align: center;
    font-size: var(--step--1);
    color: var(--foreground-l4);

    a {
      --underline: currentColor;
    }
  }
</style>
