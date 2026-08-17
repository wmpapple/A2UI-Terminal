use crate::domain::task::{
    questions_for, validate_answers, AnswerTaskInput, CreateTaskInput, TaskDetail, TaskRunResult,
    TaskStatus, TaskTemplate,
};
use crate::error::AppError;
use crate::repository::task::TaskRepository;
use crate::storage::{ManagedTaskResultRow, Storage};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use uuid::Uuid;

pub fn list_templates(storage: &Storage) -> Result<Vec<TaskTemplate>, AppError> {
    TaskRepository::new(storage).list_templates()
}

pub fn create(storage: &Storage, input: CreateTaskInput) -> Result<TaskDetail, AppError> {
    validate_identifier(&input.workspace_id, "工作区")?;
    if storage.workspace(&input.workspace_id)?.is_none() {
        return Err(AppError::InvalidInput("工作区不存在".into()));
    }
    if input.template_id.trim().is_empty() || input.template_id.chars().count() > 80 {
        return Err(AppError::InvalidInput("模板标识无效".into()));
    }
    let repository = TaskRepository::new(storage);
    let template = repository
        .latest_template(&input.template_id)?
        .ok_or_else(|| AppError::InvalidInput("模板不存在或不可用".into()))?;
    let mut answers = BTreeMap::new();
    for field in &template.fields {
        if let Some(value) = &field.default_value {
            answers.insert(field.id.clone(), value.clone());
        }
    }
    validate_answers(&template, &answers)?;
    let status = if questions_for(&template, &answers).is_empty() {
        TaskStatus::Ready
    } else {
        TaskStatus::AwaitingInput
    };
    repository.create(
        &Uuid::new_v4().to_string(),
        &input.workspace_id,
        &template,
        &answers,
        status,
    )
}

pub fn answer(storage: &Storage, input: AnswerTaskInput) -> Result<TaskDetail, AppError> {
    validate_uuid(&input.task_id, "任务")?;
    if input.answers.is_empty() {
        return Err(AppError::InvalidInput("至少需要提供一个回答".into()));
    }
    let repository = TaskRepository::new(storage);
    let current = repository
        .get(&input.task_id)?
        .ok_or_else(|| AppError::InvalidInput("任务不存在".into()))?;
    if !matches!(
        current.status,
        TaskStatus::Draft | TaskStatus::AwaitingInput
    ) {
        return Err(AppError::InvalidInput(
            "当前任务状态不允许继续回答问题".into(),
        ));
    }
    let template = repository
        .template_version(&current.template_id, current.template_version)?
        .ok_or(AppError::StateUnavailable)?;
    validate_answers(&template, &input.answers)?;
    let mut answers = current.input_answers;
    answers.extend(input.answers);
    validate_answers(&template, &answers)?;
    let status = if questions_for(&template, &answers).is_empty() {
        TaskStatus::Ready
    } else {
        TaskStatus::AwaitingInput
    };
    repository.update_answers(&input.task_id, &template, &answers, status)
}

pub fn get(storage: &Storage, task_id: &str) -> Result<TaskDetail, AppError> {
    validate_uuid(task_id, "任务")?;
    TaskRepository::new(storage)
        .get(task_id)?
        .ok_or_else(|| AppError::InvalidInput("任务不存在".into()))
}

pub fn start(
    storage: &Storage,
    managed_results_dir: &Path,
    task_id: &str,
) -> Result<TaskRunResult, AppError> {
    validate_uuid(task_id, "任务")?;
    let repository = TaskRepository::new(storage);
    let task = repository
        .get(task_id)?
        .ok_or_else(|| AppError::InvalidInput("任务不存在".into()))?;
    if task.status != TaskStatus::Ready {
        return Err(AppError::InvalidInput("任务尚未就绪或已经执行".into()));
    }
    let template = repository
        .template_version(&task.template_id, task.template_version)?
        .ok_or(AppError::StateUnavailable)?;
    let result_id = Uuid::new_v4().to_string();
    let file_name = format!("{result_id}.md");
    let output_path = managed_results_dir.join(&file_name);
    if !output_path.starts_with(managed_results_dir) {
        return Err(AppError::StateUnavailable);
    }
    fs::create_dir_all(managed_results_dir)?;
    let title = result_title(&template, &task.input_answers);
    let content = scaffold_markdown(&title, &template, &task.input_answers);
    let digest = Sha256::digest(content.as_bytes());
    let mut content_hash = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut content_hash, "{byte:02x}").expect("writing to a String cannot fail");
    }
    let revision_id = Uuid::new_v4().to_string();
    let storage_ref = format!("result://file/{result_id}");
    let managed_state = serde_json::to_string(&json!({
        "format": "markdown",
        "templateId": template.id,
        "templateVersion": template.version,
        "localScaffold": true
    }))
    .map_err(|_| AppError::StateUnavailable)?;
    let write_result = (|| -> Result<(), std::io::Error> {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)?;
        output.write_all(content.as_bytes())?;
        output.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&output_path);
        return Err(AppError::Io(error));
    }
    let result = match repository.complete_with_result(ManagedTaskResultRow {
        result_id: &result_id,
        task_id,
        workspace_id: &task.workspace_id,
        title: &title,
        storage_ref: &storage_ref,
        source_ref: &file_name,
        managed_state_json: &managed_state,
        revision_id: &revision_id,
        content: &content,
        content_hash: &content_hash,
    }) {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(&output_path);
            return Err(error);
        }
    };
    let completed = repository.get(task_id)?.ok_or(AppError::StateUnavailable)?;
    Ok(TaskRunResult {
        task: completed,
        result,
        output_mode: "local_scaffold".into(),
    })
}

fn validate_uuid(value: &str, label: &str) -> Result<(), AppError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput(format!("{label}标识无效")))
}

fn validate_identifier(value: &str, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || value.chars().count() > 128 {
        Err(AppError::InvalidInput(format!("{label}标识无效")))
    } else {
        Ok(())
    }
}

fn result_title(template: &TaskTemplate, answers: &BTreeMap<String, Value>) -> String {
    let detail = ["meetingTitle", "reportPeriod", "targetRole"]
        .iter()
        .find_map(|key| answers.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty());
    let title = detail
        .map(|detail| format!("{} - {detail}", template.name))
        .unwrap_or_else(|| template.name.clone());
    title.chars().take(160).collect()
}

fn scaffold_markdown(
    title: &str,
    template: &TaskTemplate,
    answers: &BTreeMap<String, Value>,
) -> String {
    let mut markdown = format!(
        "# {title}\n\n> 本文件是 A2UI 工作台根据“{}”模板创建的本地结构草稿；尚未调用 AI 生成正文。\n\n## 任务设置\n\n",
        template.name
    );
    for field in &template.fields {
        if let Some(value) = answers.get(&field.id).and_then(Value::as_str) {
            let safe = value.replace(['\r', '\n'], " ");
            markdown.push_str(&format!("- {}：{}\n", field.label, safe.trim()));
        }
    }
    for section in &template.default_sections {
        markdown.push_str(&format!("\n## {section}\n\n_待补充_\n"));
    }
    markdown
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::task::{AnswerTaskInput, CreateTaskInput};
    use crate::storage::Storage;

    #[test]
    fn scaffold_explicitly_discloses_that_ai_content_was_not_generated() {
        let template = TaskTemplate {
            id: "meeting_minutes".into(),
            version: 1,
            name: "会议纪要".into(),
            description: "test".into(),
            kind: crate::domain::task::TaskKind::Organize,
            desired_result_type: crate::domain::result::ResultType::Document,
            fields: Vec::new(),
            default_sections: vec!["行动项".into()],
            risk_level: "low".into(),
            builtin: true,
        };
        let markdown = scaffold_markdown("会议纪要", &template, &BTreeMap::new());
        assert!(markdown.contains("尚未调用 AI 生成正文"));
        assert!(markdown.contains("## 行动项"));
    }

    #[test]
    fn meeting_minutes_and_summary_complete_the_local_task_result_loop() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .upsert_workspace("workspace-task", "Tasks", "C:\\tasks")
            .unwrap();
        let output = tempfile::tempdir().unwrap();
        for (template_id, field_id, answer_value) in [
            ("meeting_minutes", "meetingTitle", "产品例会"),
            ("document_summary", "summaryPurpose", "快速阅读"),
        ] {
            let created = create(
                &storage,
                CreateTaskInput {
                    workspace_id: "workspace-task".into(),
                    template_id: template_id.into(),
                },
            )
            .unwrap();
            assert_eq!(created.status, TaskStatus::AwaitingInput);
            assert_eq!(created.questions.len(), 1);
            let ready = answer(
                &storage,
                AnswerTaskInput {
                    task_id: created.id.clone(),
                    answers: [(field_id.into(), Value::String(answer_value.into()))]
                        .into_iter()
                        .collect(),
                },
            )
            .unwrap();
            assert_eq!(ready.status, TaskStatus::Ready);
            let run = start(&storage, output.path(), &created.id).unwrap();
            assert_eq!(run.task.status, TaskStatus::Completed);
            assert_eq!(
                run.task.result_id.as_deref(),
                Some(run.result.summary.id.as_str())
            );
            assert_eq!(
                run.result.summary.status,
                crate::domain::result::ResultStatus::Draft
            );
            assert_eq!(run.output_mode, "local_scaffold");
            assert!(run.result.summary.current_revision_id.is_some());
            assert!(output
                .path()
                .join(format!("{}.md", run.result.summary.id))
                .is_file());
        }
    }

    #[test]
    fn task_answers_are_allowlisted_and_a_task_cannot_run_twice() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .upsert_workspace("workspace-task", "Tasks", "C:\\tasks")
            .unwrap();
        let created = create(
            &storage,
            CreateTaskInput {
                workspace_id: "workspace-task".into(),
                template_id: "meeting_minutes".into(),
            },
        )
        .unwrap();
        let invalid = answer(
            &storage,
            AnswerTaskInput {
                task_id: created.id.clone(),
                answers: [("sourceDocument".into(), Value::String("sensitive".into()))]
                    .into_iter()
                    .collect(),
            },
        );
        assert!(matches!(invalid, Err(AppError::InvalidInput(_))));
        answer(
            &storage,
            AnswerTaskInput {
                task_id: created.id.clone(),
                answers: [("meetingTitle".into(), Value::String("例会".into()))]
                    .into_iter()
                    .collect(),
            },
        )
        .unwrap();
        let output = tempfile::tempdir().unwrap();
        start(&storage, output.path(), &created.id).unwrap();
        assert!(matches!(
            start(&storage, output.path(), &created.id),
            Err(AppError::InvalidInput(_))
        ));
        assert_eq!(fs::read_dir(output.path()).unwrap().count(), 1);
    }

    #[test]
    fn four_p0_templates_are_versioned_and_never_define_source_body_fields() {
        let storage = Storage::open_in_memory().unwrap();
        let templates = list_templates(&storage).unwrap();
        assert_eq!(
            templates
                .iter()
                .map(|template| template.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "meeting_minutes",
                "document_summary",
                "weekly_report",
                "resume_optimization"
            ]
        );
        for template in templates {
            assert_eq!(template.version, 1);
            assert!(
                template
                    .fields
                    .iter()
                    .filter(|field| field.required)
                    .count()
                    <= 3
            );
            assert!(template.fields.iter().all(|field| !matches!(
                field.id.as_str(),
                "content" | "sourceText" | "documentBody" | "transcript"
            )));
        }
    }
}
