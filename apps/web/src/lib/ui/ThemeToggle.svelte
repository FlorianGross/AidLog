<!-- Cycles light → dark → system; persists the choice. -->
<script lang="ts">
  import { themePref, cycleTheme, type ThemePref } from '$lib/theme';
  import Icon from './Icon.svelte';

  const icon: Record<ThemePref, string> = { light: 'sun', dark: 'moon', system: 'monitor' };
  const label: Record<ThemePref, string> = { light: 'Hell', dark: 'Dunkel', system: 'System' };
</script>

<button
  type="button"
  class="btn-ghost min-h-touch px-3 text-sm"
  onclick={() => cycleTheme($themePref)}
  aria-label={`Darstellung: ${label[$themePref]}`}
  title={`Darstellung: ${label[$themePref]}`}
>
  <Icon name={icon[$themePref]} size={18} />
  <span class="hidden sm:inline">{label[$themePref]}</span>
</button>
