import React from 'react';
import { Card, Button, Tag, Space, Descriptions } from 'antd';
import { EnvironmentOutlined, CalendarOutlined } from '@ant-design/icons';

// 1. 组件注册表：在这里定义所有暴露给 AI 的组件
const ComponentRegistry = {
  // 案例 A：旅游行程卡片
  TravelCard: ({ destination, days, highlights }) => (
    <Card
      title={<><EnvironmentOutlined /> {destination} 行程规划</>}
      style={{ width: '100%', marginBottom: 16, borderColor: '#1890ff' }}
      headStyle={{ background: '#e6f7ff', color: '#0050b3' }}
    >
      <Descriptions column={1} size="small">
        <Descriptions.Item label={<><CalendarOutlined /> 游玩天数</>}>{days} 天</Descriptions.Item>
        <Descriptions.Item label="核心亮点">
          <Space wrap>
            {highlights?.map(tag => <Tag color="blue" key={tag}>{tag}</Tag>)}
          </Space>
        </Descriptions.Item>
      </Descriptions>
      <Button type="primary" block style={{ marginTop: 12 }}>一键预订机票酒店</Button>
    </Card>
  ),

  // 案例 B：数据分析看板（你可以无限拓展...）
  DataPanel: ({ title, dataValue, trend }) => (
    <Card style={{ width: '100%', marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}>
      <div style={{ color: '#52c41a', fontSize: '12px' }}>{title}</div>
      <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{dataValue}</div>
      <Tag color={trend === 'up' ? 'success' : 'error'}>趋势 {trend === 'up' ? '↑' : '↓'}</Tag>
    </Card>
  )
};

// 2. 动态调度工厂：接收 JSON 协议并分发渲染
const UIFactory = ({ name, props }) => {
  const Component = ComponentRegistry[name];

  if (!Component) {
    return (
      <div style={{ padding: 12, border: '1px dashed red', color: 'red', marginBottom: 16 }}>
        ⚠️ 系统错误：AI 试图调用未注册的组件 <b>{name}</b>
      </div>
    );
  }

  return <Component {...props} />;
};

export default UIFactory;