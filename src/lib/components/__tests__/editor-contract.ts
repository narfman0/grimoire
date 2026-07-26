import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

/** Common contract every structured homebrew editor honors — all of it now
 *  lives in EditorShell.svelte, so these tests lock the shell wiring
 *  (props forwarded, events re-emitted) once per host editor:
 *  - Save button disabled until name + slug are both non-empty
 *  - Slug auto-fills from name in create mode until manually edited
 *  - Slug input is disabled in edit mode
 *  - Delete button renders only in edit mode
 *  - Cancel button always fires the cancel event
 *
 *  Every editor takes its seed row as `item` and a sibling `isEdit` flag.
 *
 *  Typing note: Svelte 4's ComponentType<C> generic doesn't play nicely
 *  with a loose `Record<string, unknown>` props bag, and the strict shape
 *  varies per editor — so we accept the component as `any` here. Callers
 *  import the typed `.svelte` and pass it directly; the runtime contract
 *  is what we're locking, not the parameter types.
 */
type BuildProps = (opts: { isEdit: boolean }) => Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = any;

export function runEditorContract(
  componentName: string,
  Component: AnyComponent,
  buildProps: BuildProps
): void {
  describe(`${componentName} (editor contract)`, () => {
    it('save button is disabled when name is empty', () => {
      const { getByRole } = render(Component, { props: buildProps({ isEdit: false }) });
      const save = getByRole('button', { name: 'Save' }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
    });

    it('save button enables once name + slug are filled', async () => {
      const { getByRole, getAllByRole } = render(Component, {
        props: buildProps({ isEdit: false })
      });
      const [nameInput] = getAllByRole('textbox') as HTMLInputElement[];
      await fireEvent.input(nameInput, { target: { value: 'My Thing' } });
      const save = getByRole('button', { name: 'Save' }) as HTMLButtonElement;
      expect(save.disabled).toBe(false);
    });

    it('auto-fills slug from name in create mode', async () => {
      const { getAllByRole } = render(Component, { props: buildProps({ isEdit: false }) });
      const [nameInput, slugInput] = getAllByRole('textbox') as HTMLInputElement[];
      await fireEvent.input(nameInput, { target: { value: 'Test Thing!' } });
      expect(slugInput.value).toBe('test-thing');
    });

    it('locks slug + shows Delete in edit mode', () => {
      const { getByRole, getAllByRole } = render(Component, {
        props: buildProps({ isEdit: true })
      });
      const [, slugInput] = getAllByRole('textbox') as HTMLInputElement[];
      expect(slugInput.disabled).toBe(true);
      expect(getByRole('button', { name: 'Delete' })).not.toBeNull();
    });

    it('Cancel button dispatches the cancel event', async () => {
      const onCancel = vi.fn();
      const { getByRole, component } = render(Component, {
        props: buildProps({ isEdit: false })
      });
      component.$on('cancel', onCancel);
      await fireEvent.click(getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });
}
