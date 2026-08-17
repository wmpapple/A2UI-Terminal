import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useImportStore } from '../../imports/importStore';
import { useAppStore } from '../../../stores/useAppStore';
import { SourceDropZone } from './SourceDropZone';

describe('SourceDropZone', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspace: null,
      workspaceEntries: [],
      files: [],
      workspaceLoading: false,
      workspaceError: null,
    });
    useImportStore.setState({ batch: null, acceptedItemIds: [], loading: false, error: null });
  });

  it('keeps button selection and browser-mock drops on their distinct trusted paths', () => {
    const select = vi.fn().mockResolvedValue(undefined);
    const selectBrowserDropFallback = vi.fn().mockResolvedValue(undefined);
    useImportStore.setState({ select, selectBrowserDropFallback });
    render(
      <I18nProvider>
        <SourceDropZone />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /选择资料$/ }));
    fireEvent.drop(screen.getByTestId('home-source-drop-zone'));
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(undefined);
    expect(selectBrowserDropFallback).toHaveBeenCalledTimes(1);
    expect(selectBrowserDropFallback).toHaveBeenCalledWith(undefined);
  });
});
