import { ErrorBoundary } from './ErrorBoundary';
import { AppShell } from './AppShell';
import { I18nProvider } from './i18n/I18nProvider';

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </ErrorBoundary>
  );
}
