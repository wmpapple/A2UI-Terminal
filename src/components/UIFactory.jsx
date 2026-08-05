import { CalendarOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Space, Tag } from 'antd';

const componentRegistry = {
  TravelCard: ({ destination, days, highlights = [] }) => (
    <Card
      title={
        <>
          <EnvironmentOutlined /> {destination} 行程规划
        </>
      }
      style={{ width: '100%', marginBottom: 16, borderColor: '#1890ff' }}
      styles={{ header: { background: '#e6f7ff', color: '#0050b3' } }}
    >
      <Descriptions column={1} size="small">
        <Descriptions.Item
          label={
            <>
              <CalendarOutlined /> 游玩天数
            </>
          }
        >
          {days} 天
        </Descriptions.Item>
        <Descriptions.Item label="核心亮点">
          <Space wrap>
            {highlights.map((tag) => (
              <Tag color="blue" key={tag}>
                {tag}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>
      <Button type="primary" block style={{ marginTop: 12 }}>
        查看详情
      </Button>
    </Card>
  ),
  DataPanel: ({ title, dataValue, trend }) => (
    <Card
      style={{ width: '100%', marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}
    >
      <div style={{ color: '#52c41a', fontSize: 12 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{dataValue}</div>
      <Tag color={trend === 'up' ? 'success' : 'error'}>趋势 {trend === 'up' ? '↑' : '↓'}</Tag>
    </Card>
  ),
};

const UIFactory = ({ name, props }) => {
  const Component = componentRegistry[name];
  if (!Component) {
    return (
      <div style={{ padding: 12, border: '1px dashed red', color: 'red', marginBottom: 16 }}>
        未注册的组件：<b>{name}</b>
      </div>
    );
  }
  return <Component {...props} />;
};

export default UIFactory;
