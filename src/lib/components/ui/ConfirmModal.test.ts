import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import ConfirmModal from './ConfirmModal.svelte';
import {
  activeConfirm,
  confirmDialog,
  promptDialog,
  resolveConfirm,
  resetConfirmQueue
} from './confirm';

const base = { title: 'Delete this note?' };

describe('ConfirmModal', () => {
  // Locks the open gate — the host renders the component only while a
  // request is live, but the prop must still guard on its own.
  it('renders nothing when open=false', () => {
    const { queryByRole } = render(ConfirmModal, { props: { ...base, open: false } });
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders a labelled modal dialog with the title and message', () => {
    const { getByRole, getByText } = render(ConfirmModal, {
      props: { ...base, open: true, message: 'This cannot be undone.' }
    });
    const dialog = getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby')!;
    expect(labelledBy).toBeTruthy();
    expect(dialog.querySelector(`#${labelledBy}`)!.textContent).toContain('Delete this note?');
    expect(getByText('This cannot be undone.')).not.toBeNull();
  });

  it('confirm button dispatches confirm, cancel button dispatches cancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(ConfirmModal, {
      props: { ...base, open: true, confirmLabel: 'Delete', cancelLabel: 'Keep' },
      events: { confirm: (e) => onConfirm(e.detail), cancel: onCancel }
    });

    await fireEvent.click(getByText('Keep'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('dispatches confirm with the input value', async () => {
    const onConfirm = vi.fn();
    const { getByRole, getByText } = render(ConfirmModal, {
      props: {
        ...base,
        open: true,
        confirmLabel: 'OK',
        input: { initial: 'my-slug', label: 'New slug' }
      },
      events: { confirm: (e) => onConfirm(e.detail) }
    });
    const field = getByRole('textbox') as HTMLInputElement;
    expect(field.value).toBe('my-slug');
    await fireEvent.input(field, { target: { value: 'other-slug' } });
    await fireEvent.click(getByText('OK'));
    expect(onConfirm).toHaveBeenCalledWith({ value: 'other-slug' });
  });

  // Locks the keyboard contract.
  it('Escape cancels', async () => {
    const onCancel = vi.fn();
    render(ConfirmModal, { props: { ...base, open: true }, events: { cancel: onCancel } });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Enter confirms when focus is not on a button', async () => {
    const onConfirm = vi.fn();
    const { getByRole } = render(ConfirmModal, {
      props: { ...base, open: true, input: { initial: 'x' } },
      events: { confirm: (e) => onConfirm(e.detail) }
    });
    await fireEvent.keyDown(getByRole('textbox'), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith({ value: 'x' });
  });

  // A button activates itself on Enter; confirming again would double-fire
  // (and would confirm when the user meant to cancel).
  it('Enter on the cancel button does not confirm', async () => {
    const onConfirm = vi.fn();
    const { getByText } = render(ConfirmModal, {
      props: { ...base, open: true },
      events: { confirm: onConfirm }
    });
    await fireEvent.keyDown(getByText('Cancel'), { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('backdrop click cancels', async () => {
    const onCancel = vi.fn();
    const { getByRole } = render(ConfirmModal, {
      props: { ...base, open: true },
      events: { cancel: onCancel }
    });
    const backdrop = getByRole('presentation');
    await fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('a click inside the dialog does not cancel', async () => {
    const onCancel = vi.fn();
    const { getByRole } = render(ConfirmModal, {
      props: { ...base, open: true },
      events: { cancel: onCancel }
    });
    await fireEvent.click(getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Only one answer per dialog, whatever the user hammers.
  it('dispatches at most one outcome', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(ConfirmModal, {
      props: { ...base, open: true },
      events: { confirm: onConfirm, cancel: onCancel }
    });
    await fireEvent.click(getByText('Confirm'));
    await fireEvent.click(getByText('Confirm'));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('danger variant styles the confirm button red', () => {
    const { getByText } = render(ConfirmModal, {
      props: { ...base, open: true, danger: true, confirmLabel: 'Delete' }
    });
    expect(getByText('Delete').className).toContain('bg-red-700');
  });

  // Focus moves into the dialog on open and returns to the trigger on close.
  it('focuses the confirm button on open and restores focus on unmount', async () => {
    const trigger = globalThis.document.createElement('button');
    globalThis.document.body.appendChild(trigger);
    trigger.focus();
    expect(globalThis.document.activeElement).toBe(trigger);

    const { getByText, unmount } = render(ConfirmModal, { props: { ...base, open: true } });
    await tick();
    expect(globalThis.document.activeElement).toBe(getByText('Confirm'));

    unmount();
    expect(globalThis.document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('focuses the text field when the dialog has one', async () => {
    const { getByRole } = render(ConfirmModal, {
      props: { ...base, open: true, input: { initial: 'seed' } }
    });
    await tick();
    expect(globalThis.document.activeElement).toBe(getByRole('textbox'));
  });

  // Tab from the last focusable element wraps to the first — focus stays
  // inside the dialog.
  it('traps Tab inside the dialog', async () => {
    const { getByText } = render(ConfirmModal, { props: { ...base, open: true } });
    await tick();
    const confirmBtn = getByText('Confirm');
    const cancelBtn = getByText('Cancel');
    expect(globalThis.document.activeElement).toBe(confirmBtn);

    await fireEvent.keyDown(confirmBtn, { key: 'Tab' });
    expect(globalThis.document.activeElement).toBe(cancelBtn);

    await fireEvent.keyDown(cancelBtn, { key: 'Tab', shiftKey: true });
    expect(globalThis.document.activeElement).toBe(confirmBtn);
  });
});

describe('confirm queue', () => {
  afterEach(() => resetConfirmQueue());

  it('confirmDialog publishes a request and resolves true on confirm', async () => {
    const promise = confirmDialog({ title: 'Delete this row?', danger: true });
    const req = get(activeConfirm)!;
    expect(req.title).toBe('Delete this row?');
    expect(req.danger).toBe(true);
    // danger defaults the confirm label to "Delete".
    expect(req.confirmLabel).toBe('Delete');
    expect(req.input).toBeNull();

    resolveConfirm('');
    await expect(promise).resolves.toBe(true);
    expect(get(activeConfirm)).toBeNull();
  });

  it('confirmDialog resolves false on cancel', async () => {
    const promise = confirmDialog({ title: 'Sure?' });
    resolveConfirm(null);
    await expect(promise).resolves.toBe(false);
  });

  it('promptDialog carries the default value and resolves the entered string', async () => {
    const promise = promptDialog({ title: 'New slug:', defaultValue: 'seed' });
    expect(get(activeConfirm)!.input).toEqual({
      label: undefined,
      placeholder: undefined,
      initial: 'seed'
    });
    resolveConfirm('typed');
    await expect(promise).resolves.toBe('typed');
  });

  it('promptDialog resolves null on cancel', async () => {
    const promise = promptDialog({ title: 'New slug:' });
    resolveConfirm(null);
    await expect(promise).resolves.toBeNull();
  });

  // Two overlapping asks must not clobber each other — the second only
  // becomes active once the first is answered.
  it('queues concurrent requests FIFO', async () => {
    const first = confirmDialog({ title: 'first' });
    const second = confirmDialog({ title: 'second' });
    expect(get(activeConfirm)!.title).toBe('first');

    resolveConfirm('');
    await expect(first).resolves.toBe(true);
    expect(get(activeConfirm)!.title).toBe('second');

    resolveConfirm(null);
    await expect(second).resolves.toBe(false);
    expect(get(activeConfirm)).toBeNull();
  });

  it('each request gets a distinct id so the host remounts the modal', () => {
    void confirmDialog({ title: 'a' });
    const firstId = get(activeConfirm)!.id;
    resolveConfirm(null);
    void confirmDialog({ title: 'b' });
    expect(get(activeConfirm)!.id).not.toBe(firstId);
  });
});
