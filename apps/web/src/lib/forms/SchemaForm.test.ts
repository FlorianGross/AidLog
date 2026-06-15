import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SchemaForm from './SchemaForm.svelte';
import { exampleSchema } from './example-schema';

describe('SchemaForm.svelte (dynamic renderer)', () => {
  it('renders inputs derived from the schema (labels + a select)', () => {
    render(SchemaForm, { props: { schema: exampleSchema } });
    // labelled inputs from the schema
    expect(screen.getByLabelText(/Location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Patient pseudonym/i)).toBeInTheDocument();
    // enum became a <select> with options
    const ageBand = screen.getByLabelText(/Age band/i) as HTMLSelectElement;
    expect(ageBand.tagName).toBe('SELECT');
    expect([...ageBand.options].some((o) => o.value === '18-39')).toBe(true);
    // grouped vitals legend present
    expect(screen.getByText('Vital signs')).toBeInTheDocument();
  });

  it('blocks submit and shows errors for invalid data', async () => {
    const onsubmit = vi.fn();
    render(SchemaForm, { props: { schema: exampleSchema, onsubmit } });
    // submit empty → required errors, no emit
    await fireEvent.submit(screen.getByRole('button', { name: /save record/i }).closest('form')!);
    expect(onsubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('emits validated, expanded data on a complete submit', async () => {
    const onsubmit = vi.fn();
    render(SchemaForm, { props: { schema: exampleSchema, onsubmit } });

    await fireEvent.input(screen.getByLabelText(/Time of contact/i), {
      target: { value: '2026-06-11T10:30' },
    });
    await fireEvent.input(screen.getByLabelText(/Location/i), { target: { value: 'Post A' } });
    await fireEvent.input(screen.getByLabelText(/Patient pseudonym/i), {
      target: { value: 'Patient 7' },
    });
    await fireEvent.change(screen.getByLabelText(/Age band/i), { target: { value: '40-64' } });
    await fireEvent.input(screen.getByLabelText(/Chief complaint/i), {
      target: { value: 'Sprained ankle' },
    });
    // a nested vital, proving group flatten → expand round-trips
    await fireEvent.input(screen.getByLabelText(/SpO2/i), { target: { value: '97' } });

    await fireEvent.submit(screen.getByRole('button', { name: /save record/i }).closest('form')!);

    expect(onsubmit).toHaveBeenCalledTimes(1);
    const detail = onsubmit.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(detail.data['location']).toBe('Post A');
    expect(detail.data['ageBand']).toBe('40-64');
    expect((detail.data['vitals'] as Record<string, unknown>)['spo2']).toBe(97);
  });
});
