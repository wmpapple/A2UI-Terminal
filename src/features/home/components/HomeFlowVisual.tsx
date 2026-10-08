import { FileDoneOutlined, FileTextOutlined, HighlightOutlined } from '@ant-design/icons';
import styles from './HomePage.module.css';

export function HomeFlowVisual({ locale }: { locale: string }) {
  const labels = locale === 'zh-CN' ? ['资料', '构思', '成果'] : ['Sources', 'Ideas', 'Results'];

  return (
    <div className={styles.flowVisual} aria-hidden="true">
      <svg className={styles.flowLines} viewBox="0 0 360 176" preserveAspectRatio="none">
        <path className={styles.flowTrack} d="M 84 110 C 122 110 123 56 165 56" />
        <path className={styles.flowTrack} d="M 212 56 C 258 56 253 111 293 111" />
        <path className={styles.flowStream} d="M 84 110 C 122 110 123 56 165 56" />
        <path className={styles.flowStream} d="M 212 56 C 258 56 253 111 293 111" />
        <circle className={styles.flowHalo} cx="183" cy="56" r="47" />
        <circle className={styles.flowHaloInner} cx="183" cy="56" r="33" />
      </svg>
      <div className={`${styles.flowNode} ${styles.flowNodeSource}`}>
        <FileTextOutlined />
        <span>{labels[0]}</span>
      </div>
      <div className={`${styles.flowNode} ${styles.flowNodeIdea}`}>
        <HighlightOutlined />
        <span>{labels[1]}</span>
      </div>
      <div className={`${styles.flowNode} ${styles.flowNodeResult}`}>
        <FileDoneOutlined />
        <span>{labels[2]}</span>
      </div>
    </div>
  );
}
