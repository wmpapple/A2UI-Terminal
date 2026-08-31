import { Button, Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import type {
  CreateTextResultInput,
  ResultType,
  TextResultFormat,
} from '../../../shared/types/domain';
import {
  defaultFormatForResultType,
  resultAdapterDefinitions,
  suggestedResultFileName,
} from '../resultAdapters';
import { useResultStore } from '../resultStore';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCreated: (resultId: string) => void;
}

interface FormValues {
  title: string;
  fileName: string;
  type: ResultType;
  format: TextResultFormat;
}

export function CreateTextResultModal({ open, onCancel, onCreated }: Props) {
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const createTextResult = useResultStore((state) => state.createTextResult);
  const loading = useResultStore((state) => state.loading);
  const error = useResultStore((state) => state.error);
  const clearError = useResultStore((state) => state.clearError);
  const resultType = Form.useWatch('type', form) ?? 'document';

  useEffect(() => {
    if (open) {
      clearError();
      form.setFieldsValue({ title: '', fileName: '', type: 'document', format: 'markdown' });
    }
  }, [clearError, form, open]);

  const create = async (values: FormValues) => {
    const input: CreateTextResultInput = {
      title: values.title.trim(),
      fileName: values.fileName.trim(),
      type: values.type,
      format: values.format,
    };
    const created = await createTextResult(input);
    if (created) onCreated(created.result.id);
  };

  const updateSuggestedFileName = () => {
    const title = form.getFieldValue('title')?.trim();
    const type = form.getFieldValue('type') ?? 'document';
    if (title) form.setFieldValue('fileName', suggestedResultFileName(title, type));
  };

  const changeType = (type: ResultType) => {
    form.setFieldValue('format', defaultFormatForResultType(type));
    window.setTimeout(updateSuggestedFileName, 0);
  };

  return (
    <Modal open={open} title={t('createResult')} footer={null} destroyOnHidden onCancel={onCancel}>
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{ type: 'document', format: 'markdown' }}
        onFinish={(values) => void create(values)}
      >
        <Form.Item
          name="title"
          label={t('resultTitle')}
          rules={[{ required: true, max: 160, message: t('resultTitleRequired') }]}
        >
          <Input maxLength={160} showCount onBlur={updateSuggestedFileName} />
        </Form.Item>
        <Form.Item name="type" label={t('resultType')} rules={[{ required: true }]}>
          <Select
            onChange={changeType}
            options={(Object.keys(resultAdapterDefinitions) as ResultType[]).map((type) => ({
              value: type,
              label: t(resultAdapterDefinitions[type].labelKey as MessageKey),
            }))}
          />
        </Form.Item>
        <Form.Item name="format" label={t('resultFormat')} rules={[{ required: true }]}>
          <Select
            disabled={resultType !== 'document'}
            onChange={updateSuggestedFileName}
            options={
              resultType === 'document'
                ? [
                    { value: 'markdown', label: 'Markdown (.md)' },
                    { value: 'plain_text', label: `${t('plainText')} (.txt)` },
                  ]
                : [
                    {
                      value: defaultFormatForResultType(resultType),
                      label: defaultFormatForResultType(resultType).toUpperCase(),
                    },
                  ]
            }
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
