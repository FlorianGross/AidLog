import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ChipSelect from './ChipSelect.svelte';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
];

describe('ChipSelect.svelte (tap-chip single select)', () => {
  it('renders a radio per option and marks the current value checked', () => {
    render(ChipSelect, { props: { options, value: 'b', onchange: () => {} } });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Bravo' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'false');
  });

  it('emits the exact option value on tap (same semantics as a <select>)', async () => {
    const onchange = vi.fn();
    render(ChipSelect, { props: { options, value: '', onchange } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
    expect(onchange).toHaveBeenCalledExactlyOnceWith('c');
  });

  it('surfaces a reachable none chip that stores the empty value', async () => {
    const onchange = vi.fn();
    render(ChipSelect, {
      props: { options, value: 'a', allowNone: true, noneLabel: '— none —', onchange },
    });
    const none = screen.getByRole('radio', { name: '— none —' });
    expect(none).toBeInTheDocument();
    await fireEvent.click(none);
    expect(onchange).toHaveBeenCalledExactlyOnceWith('');
  });

  it('does not emit when disabled (read-only)', async () => {
    const onchange = vi.fn();
    render(ChipSelect, { props: { options, value: 'a', disabled: true, onchange } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
    expect(onchange).not.toHaveBeenCalled();
  });
});
