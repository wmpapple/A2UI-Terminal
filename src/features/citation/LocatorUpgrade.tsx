import { Alert, Button, Space } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { citationController } from './citationController';
import type { UpgradeProgress } from '../../shared/types/citation';
import { errorDetails } from '../../stores/support';

export function LocatorUpgrade() {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [running, setRunning] = useState(true);
  const [progress, setProgress] = useState<UpgradeProgress | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = async () => {
      try {
        const next = await citationController.upgrade(running);
        if (!active) return;
        setProgress(next);
        setError('');
        if (running && next.pending > 0) timer = setTimeout(() => void step(), 100);
      } catch (e) {
        if (active) setError(errorDetails(e).message);
      }
    };
    void step();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [running, attempt]);
  if (!error && (!progress || (progress.pending === 0 && progress.failed === 0))) return null;
  return (
    <div>
      <Alert
        type={error ? 'error' : 'info'}
        showIcon
        title={
          error ||
          (zh
            ? `正在完善资料定位：已完成 ${progress?.completed}，待处理 ${progress?.pending}，失败 ${progress?.failed}`
            : `Source locations: ${progress?.completed} completed, ${progress?.pending} pending, ${progress?.failed} failed`)
        }
        closable
      />
      <Space>
        <Button onClick={() => setRunning((v) => !v)}>
          {running ? (zh ? '暂停' : 'Pause') : zh ? '继续' : 'Continue'}
        </Button>
        {progress?.failed ? (
          <Button
            onClick={() =>
              void citationController
                .upgrade(false, true)
                .then((p) => {
                  setProgress(p);
                  setRunning(true);
                  setAttempt((value) => value + 1);
                })
                .catch((e) => setError(errorDetails(e).message))
            }
          >
            {zh ? '重试失败项' : 'Retry failed sources'}
          </Button>
        ) : null}
      </Space>
      {progress?.errors.map((e) => (
        <p key={e}>{e}</p>
      ))}
    </div>
  );
}
