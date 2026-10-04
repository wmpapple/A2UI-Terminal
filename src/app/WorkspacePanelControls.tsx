import { MenuFoldOutlined, MenuUnfoldOutlined, RobotOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useI18n } from './i18n/useI18n';
import { useWorkspacePanels } from './workspacePanels';

export function WorkspacePanelControls({ leftLabels }: { leftLabels?: [string, string] } = {}) {
  const panels = useWorkspacePanels();
  const { t } = useI18n();
  if (!panels) return null;
  const leftLabel =
    leftLabels?.[panels.leftCollapsed ? 1 : 0] ??
    t(panels.leftCollapsed ? 'expandFilePanel' : 'collapseFilePanel');
  const rightLabel = t(panels.rightCollapsed ? 'expandAiPanel' : 'collapseAiPanel');
  return (
    <>
      {panels.leftAvailable && (
        <Tooltip title={leftLabel}>
          <Button
            size="small"
            type="text"
            aria-label={leftLabel}
            aria-expanded={!panels.leftCollapsed}
            onClick={panels.toggleLeft}
            icon={panels.leftCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          />
        </Tooltip>
      )}
      <Tooltip title={rightLabel}>
        <Button
          size="small"
          type="text"
          aria-label={rightLabel}
          aria-expanded={!panels.rightCollapsed}
          onClick={panels.toggleRight}
          icon={<RobotOutlined />}
        />
      </Tooltip>
    </>
  );
}
