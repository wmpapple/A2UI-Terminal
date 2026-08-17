import { Button, Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { CreateTextResultInput, TextResultFormat } from '../../../shared/types/domain';
import { useResultStore } from '../resultStore';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (resultId: string) => void;
}

interface FormValues {
  title: string;
  fileName: string;
  format: TextResultFormat;
}

export function CreateTextResultModal({ open, onCancel, onCreated }: Props) {
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const createTextResult = useResultStore((state) => state.createTextResult);
  const loading = useResultStore((state) => state.loading);
  const error = useResultStore((state) => state.error);
  const clearError = useResultStore((state) => state.clearError);

  useEffect(() => {
    if (open) {
      clearError();
      form.setFieldsValue({ title: '', fileName: '', format: 'markdown' });
    }
  }, [clearError, form, open]);

  const create = async (values: FormValues) => {
    const input: CreateTextResultInput = {
      title: values.title.trim(),
      fileName: values.fileName.trim(),
      format: values.format,
    };
    const created = await createTextResult(input);
    if (created) onCreated(created.result.id);
  };

  const updateSuggestedFileName = () => {
    const title = form.getFieldValue('title')?.trim();
    const format = form.getFieldValue('format') ?? 'markdown';
    if (title) form.setFieldValue('fileName', `${title}.${format === 'markdown' ? 'md' : 'txt'}`);
  };

  return (
    <Modal
      open={open}
      title={t('createTextResult')}
      footer={null}
      destroyOnHidden
      onCancel={onCancel}
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{ format: 'markdown' }}
        onFinish={(values) => void create(values)}
      >
        <Form.Item
          name="title"
          label={t('resultTitle')}
          rules={[{ required: true, max: 160, message: t('resultTitleRequired') }]}
        >
          <Input maxLength={160} showCount onBlur={updateSuggestedFileName} />
        </Form.Item>
        <Form.Item name="format" label={t('resultFormat')} rules={[{ required: true }]}>
          <Select
            onChange={updateSuggestedFileName}
            options={[
              { value: 'markdown', label: 'Markdown (.md)' },
              { value: 'plain_text', label: `${t('plainText')} (.txt)` },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="fileName"
          label={t('resultFileName')}
          extra={t('resultFileNameHint')}
          rules={[{ required: true, max: 120, message: t('resultFileNameRequired') }]}
        >
          <Input maxLength={120} />
        </Form.Item>
        {error ? <p role="alert">{error}</p> : null}
        <Button type="primary" htmlType="submit" loading={loading} block>
          {t('createAndOpen')}
        </Button>
      </Form>
    </Modal>
  );
}
