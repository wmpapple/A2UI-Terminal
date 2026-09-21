import { Input, Modal, type InputRef } from 'antd';
import { useId, useRef, useState } from 'react';
import { AuthorizedSearch } from '../features/home/components/AuthorizedSearch';
import { useAppStore } from '../stores/useAppStore';
import { useI18n } from './i18n/useI18n';
import type { AppRoute } from './shellPreferences';
import styles from './CommandPalette.module.css';

interface Props {
  onClose: () => void;
  onNavigate: (route: AppRoute) => void;
  onCreate: () => void;
  onOpenWorkbench: (resultId?: string) => void;
}

export function CommandPalette({ onClose, onNavigate, onCreate, onOpenWorkbench }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<InputRef>(null);
  const listId = useId();
  const workspaceId = useAppStore((state) => state.workspace?.id);
  const run = (action: () => void) => {
    onClose();
    action();
  };
  const commands = [
    { id: 'create', label: t('createResult'), action: onCreate },
    ...(['home', 'results', 'templates', 'workbench', 'settings'] as const).map((route) => ({
      id: route,
      label: t(route === 'settings' ? 'settings' : `${route}Navigation`),
      action: () => onNavigate(route),
    })),
  ].filter((command) =>
    command.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  return (
    <Modal
      open
      title={t('commandPalette')}
      footer={null}
      width={720}
      onCancel={onClose}
      afterOpenChange={(open) => {
        if (open) inputRef.current?.focus();
      }}
    >
      <Input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={t('commandPlaceholder')}
        role="combobox"
        aria-label={t('commandPalette')}
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={commands[active] ? `${listId}-${commands[active].id}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (commands.length)
              setActive(
                (current) =>
                  (current + (event.key === 'ArrowDown' ? 1 : commands.length - 1)) %
                  commands.length
              );
          } else if (event.key === 'Enter' && commands[active]) {
            event.preventDefault();
            run(commands[active].action);
          }
        }}
      />
      <div id={listId} role="listbox" aria-label={t('commandPalette')} className={styles.commands}>
        {commands.map((command, index) => (
          <div
            key={command.id}
            id={`${listId}-${command.id}`}
            role="option"
            aria-selected={active === index}
            className={styles.command}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(command.action)}
            onMouseEnter={() => setActive(index)}
          >
            {command.label}
          </div>
        ))}
      </div>
      {!commands.length && <p role="status">{t('noCommands')}</p>}
      <div className={styles.search}>
        <AuthorizedSearch
          key={workspaceId}
          onOpenWorkbench={(id) => run(() => onOpenWorkbench(id))}
        />
      </div>
    </Modal>
  );
}
