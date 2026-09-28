import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { CitationPanel } from './CitationPanel';
import { citationController } from './citationController';
import type { CitationView } from '../../shared/types/citation';

vi.mock('./citationController', () => ({ citationController: { list: vi.fn() } }));
const source: CitationView = {
  key: 'S1',
  title: 'Budget',
  locator: { kind: 'page', page: 2 },
  status: 'verified',
  excerpt: 'Original budget: 420',
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
const mount = (dirty = false) =>
  render(
    <I18nProvider>
      <CitationPanel ownerKind="result" ownerId="result" content="Budget [S1]" dirty={dirty} />
    </I18nProvider>
  );
it('revalidates before showing source text and never displays deleted cached excerpts', async () => {
  vi.mocked(citationController.list)
    .mockResolvedValueOnce([source])
    .mockResolvedValueOnce([{ ...source, status: 'unavailable', excerpt: null }]);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /\[S1\].*Budget/ }));
  await waitFor(() => expect(citationController.list).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Original budget: 420')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByText(/当前引用无法显示已核验原文|Verified source text is unavailable/)
    ).toBeVisible()
  );
});
it('opens the exact page excerpt with one click and marks unsaved text unverified', async () => {
  vi.mocked(citationController.list).mockResolvedValue([source]);
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: /\[S1\].*Budget/ }));
  await waitFor(() => expect(screen.getByText('Original budget: 420')).toBeVisible());
  expect(screen.getByText(/第 2 页|Page 2/)).toBeVisible();
  view.unmount();
  mount(true);
  fireEvent.click(await screen.findByRole('button', { name: /\[S1\]/ }));
  expect(citationController.list).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Original budget: 420')).not.toBeInTheDocument();
});

it('refreshes citation status when autosave finishes without changing the visible text', async () => {
  vi.mocked(citationController.list).mockResolvedValue([source]);
  const view = mount(true);
  await screen.findByRole('button', { name: /\[S1\]/ });
  expect(citationController.list).not.toHaveBeenCalled();
  view.rerender(
    <I18nProvider>
      <CitationPanel ownerKind="result" ownerId="result" content="Budget [S1]" dirty={false} />
    </I18nProvider>
  );
  await screen.findByRole('button', { name: /\[S1\].*Budget/ });
  expect(citationController.list).toHaveBeenCalledTimes(1);
});

it('does not reopen a closed preview when source validation finishes later', async () => {
  let finish: (value: CitationView[]) => void = () => {};
  vi.mocked(citationController.list)
    .mockResolvedValueOnce([source])
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /\[S1\].*Budget/ }));
  fireEvent.click(screen.getByRole('button', { name: /Close|关闭/ }));
  finish([source]);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText('Original budget: 420')).not.toBeInTheDocument();
});
