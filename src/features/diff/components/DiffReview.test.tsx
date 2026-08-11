import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { createMockDiff, mockFiles } from '../../../shared/mock/workspace';
import { useAppStore } from '../../../stores/useAppStore';
import { DiffReview } from './DiffReview';

beforeEach(() => {
  useAppStore.setState({
    runtimeMode: 'web-mock',
    files: mockFiles,
    pendingDiff: createMockDiff(mockFiles[0]),
    patchApplying: false,
    patchError: null,
  });
});

describe('DiffReview', () => {
  it('renders only validated semantic blocks with before and after content', () => {
    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );

    expect(screen.getByText('已通过 Rust 校验')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('修改前')).toBeInTheDocument();
    expect(screen.getByText('修改后')).toBeInTheDocument();
  });

  it('allows a block to be rejected before applying', () => {
    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'README.md' }));
    expect(screen.getByRole('button', { name: /应用已选修改/ })).toBeDisabled();
    expect(useAppStore.getState().pendingDiff?.changes[0].selected).toBe(false);
  });
});
