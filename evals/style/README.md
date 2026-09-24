# M2 写作偏好 Eval 基线

`cases.jsonl` 固定 40 个虚构中文任务，覆盖事实保留、数字、人名、日期、否定关系、术语、禁用词、当前指令覆盖长期偏好和恶意资料指令。`npm run eval:style:validate` 只检查 fixture 完整性，不联网、不读取 API Key，也不调用模型。

真实 Provider 评测必须由用户显式发起，并将数据集版本、Provider、模型名、参数、Prompt Composer 版本、运行日期和重复次数写入独立结果文件。机械评分检查 `expectedFacts`、`requiredTerms` 与 `forbiddenTerms`；“无依据新增事实”和整体风格需盲评。首次真实基线完成前不虚构通过率或质量门槛，BYOK 自定义模型显示为“未验证”。
