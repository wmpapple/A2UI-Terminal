import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useImportStore } from '../../imports/importStore';
import { useAppStore } from '../../../stores/useAppStore';
import { SourceDropZone } from './SourceDropZone';

const { listenForDropsMock, setDropTargetMock } = vi.hoisted(() => ({
  listenForDropsMock: vi.fn(),
  setDropTargetMock: vi.fn(),
}));

vi.mock('../../imports/importController', () => ({
  importController: {
    listenForDrops: listenForDropsMock,
    setDropTarget: setDropTargetMock,
  },
}));

describe('SourceDropZone', () => {
  beforeEach(() => {
    listenForDropsMock.mockReset().mockResolvedValue(() => undefined);
    setDropTargetMock.mockReset().mockResolvedValue(undefined);
    useAppStore.setState({
      workspace: null,
      workspaceEntries: [],
      files: [],
      workspaceLoading: false,
      workspaceError: null,
    });
    useImportStore.setState({ batch: null, acceptedItemIds: [], loading: false, error: null });
  });

  it('uses a fresh native target id when StrictMode remounts the effect', async () => {
    const boundsMock = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 410,
      bottom: 220,
      width: 400,
      height: 200,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });

    try {
      render(
        <StrictMode>
          <I18nProvider>
            <SourceDropZone />
          </I18nProvider>
        </StrictMode>
      );

      await waitFor(() => {
        const enabledCalls = setDropTargetMock.mock.calls.filter(([input]) => input.enabled);
        expect(enabledCalls.length).toBeGreaterThanOrEqual(2);
      });

      const enabledTargets = setDropTargetMock.mock.calls
        .map(([input]) => input)
        .filter((input) => input.enabled)
        .map((input) => input.targetId);
      const disabledTargets = setDropTargetMock.mock.calls
        .map(([input]) => input)
        .filter((input) => !input.enabled)
        .map((input) => input.targetId);

      expect(new Set(enabledTargets).size).toBe(enabledTargets.length);
      expect(disabledTargets).toContain(enabledTargets[0]);
      expect(disabledTargets).not.toContain(enabledTargets.at(-1));
    } finally {
      boundsMock.mockRestore();
    }
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
