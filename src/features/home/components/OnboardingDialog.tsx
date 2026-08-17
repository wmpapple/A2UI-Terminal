import { Button, Checkbox, Modal, Radio, Steps } from 'antd';
import { useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import { SourceDropZone } from './SourceDropZone';
import styles from './OnboardingDialog.module.css';

interface Props {
  open: boolean;
  onFinish: () => void;
  onSkip: () => void;
}

const goals = ['write', 'modify', 'organize', 'analyze', 'build', 'free'] as const;
const goalTitleKeys: Record<(typeof goals)[number], MessageKey> = {
  write: 'homeActionWriteTitle',
  modify: 'homeActionModifyTitle',
  organize: 'homeActionOrganizeTitle',
  analyze: 'homeActionAnalyzeTitle',
  build: 'homeActionBuildTitle',
  free: 'homeActionFreeTitle',
};

export function OnboardingDialog({ open, onFinish, onSkip }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<(typeof goals)[number] | null>(null);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);

  const reset = () => {
    setStep(0);
    setGoal(null);
    setPrivacyConfirmed(false);
  };

  const finish = () => {
    if (!privacyConfirmed) return;
    reset();
    onFinish();
  };

  const skip = () => {
    reset();
    onSkip();
  };

  return (
    <Modal
      open={open}
      width={680}
      title={t('onboardingTitle')}
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      destroyOnHidden
      footer={
        <div className={styles.footer}>
          <Button type="text" onClick={skip}>
            {t('skipOnboarding')}
          </Button>
          <div className={styles.footerActions}>
            {step > 0 ? (
              <Button onClick={() => setStep((value) => value - 1)}>{t('back')}</Button>
            ) : null}
            {step < 2 ? (
              <Button
                type="primary"
                disabled={step === 0 && !goal}
                onClick={() => setStep((value) => value + 1)}
              >
                {t('next')}
              </Button>
            ) : (
              <Button type="primary" disabled={!privacyConfirmed} onClick={finish}>
                {t('finishOnboarding')}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <Steps
        current={step}
        size="small"
        items={[
          { title: t('onboardingGoalStep') },
          { title: t('onboardingSourcesStep') },
          { title: t('onboardingPrivacyStep') },
        ]}
      />
      <div className={styles.stepBody}>
        {step === 0 ? (
          <>
            <p className={styles.intro}>{t('onboardingGoalDescription')}</p>
            <Radio.Group
              className={styles.goalGrid}
              value={goal}
              onChange={(event) => setGoal(event.target.value as (typeof goals)[number])}
            >
              {goals.map((item) => (
                <Radio key={item} className={styles.goalOption} value={item}>
                  {t(goalTitleKeys[item])}
                </Radio>
              ))}
            </Radio.Group>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <p className={styles.intro}>{t('onboardingSourcesDescription')}</p>
            <SourceDropZone />
          </>
        ) : null}
        {step === 2 ? (
          <>
            <p className={styles.intro}>{t('onboardingPrivacyDescription')}</p>
            <div className={styles.privacyCard}>
              <ul className={styles.privacyList}>
                <li>{t('onboardingPrivacyLocal')}</li>
                <li>{t('onboardingPrivacyCloud')}</li>
                <li>{t('onboardingPrivacyMetrics')}</li>
              </ul>
              <Checkbox
                checked={privacyConfirmed}
                onChange={(event) => setPrivacyConfirmed(event.target.checked)}
              >
                {t('onboardingPrivacyConfirm')}
              </Checkbox>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
