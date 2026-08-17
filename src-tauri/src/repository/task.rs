use crate::domain::result::{ResultDetail, ResultType};
use crate::domain::task::{questions_for, TaskDetail, TaskKind, TaskStatus, TaskTemplate};
use crate::error::AppError;
use crate::repository::result::detail_from_row;
use crate::storage::{ManagedTaskResultRow, NewTaskRow, Storage, TaskRow, TaskTemplateRow};
use serde_json::Value;
use std::collections::BTreeMap;

pub struct TaskRepository<'a> {
    storage: &'a Storage,
}

impl<'a> TaskRepository<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn list_templates(&self) -> Result<Vec<TaskTemplate>, AppError> {
        self.storage
            .task_templates()?
            .into_iter()
            .map(template_from_row)
            .collect()
    }

    pub fn latest_template(&self, template_id: &str) -> Result<Option<TaskTemplate>, AppError> {
        self.storage
            .task_template(template_id)?
            .map(template_from_row)
            .transpose()
    }

    pub fn template_version(
        &self,
        template_id: &str,
        version: u32,
    ) -> Result<Option<TaskTemplate>, AppError> {
        self.storage
            .task_template_version(template_id, version)?
            .map(template_from_row)
            .transpose()
    }

    pub fn create(
        &self,
        id: &str,
        workspace_id: &str,
        template: &TaskTemplate,
        answers: &BTreeMap<String, Value>,
        status: TaskStatus,
    ) -> Result<TaskDetail, AppError> {
        let questions = questions_for(template, answers);
        let answers_json =
            serde_json::to_string(answers).map_err(|_| AppError::StateUnavailable)?;
        let row = self.storage.insert_task(NewTaskRow {
            id,
            workspace_id,
            template_id: &template.id,
            template_version: template.version,
            task_kind: task_kind_value(template.kind),
            desired_result_type: "document",
            status: task_status_value(status),
            input_answers_json: &answers_json,
            question_count: questions.len() as u32,
        })?;
        task_from_row(row, template)
    }

    pub fn get(&self, task_id: &str) -> Result<Option<TaskDetail>, AppError> {
        let Some(row) = self.storage.task(task_id)? else {
            return Ok(None);
        };
        let template = self
            .template_version(&row.template_id, row.template_version)?
            .ok_or(AppError::StateUnavailable)?;
        task_from_row(row, &template).map(Some)
    }

    pub fn update_answers(
        &self,
        task_id: &str,
        template: &TaskTemplate,
        answers: &BTreeMap<String, Value>,
        status: TaskStatus,
    ) -> Result<TaskDetail, AppError> {
        let questions = questions_for(template, answers);
        let answers_json =
            serde_json::to_string(answers).map_err(|_| AppError::StateUnavailable)?;
        let row = self.storage.update_task_answers(
            task_id,
            &answers_json,
            task_status_value(status),
            questions.len() as u32,
        )?;
        task_from_row(row, template)
    }

    pub fn complete_with_result(
        &self,
        input: ManagedTaskResultRow<'_>,
    ) -> Result<ResultDetail, AppError> {
        detail_from_row(self.storage.complete_task_with_managed_result(input)?)
    }
}

fn template_from_row(row: TaskTemplateRow) -> Result<TaskTemplate, AppError> {
    let fields =
        serde_json::from_str(&row.field_schema_json).map_err(|_| AppError::StateUnavailable)?;
    let template = TaskTemplate {
        id: row.id,
        version: row.version,
        name: row.name,
        description: row.description,
        kind: parse_task_kind(&row.task_kind)?,
        desired_result_type: parse_result_type(&row.desired_result_type)?,
        fields,
        default_sections: serde_json::from_str(&row.default_sections_json)
            .map_err(|_| AppError::StateUnavailable)?,
        risk_level: row.risk_level,
        builtin: row.builtin,
    };
    if template
        .fields
        .iter()
        .filter(|field| field.required)
        .count()
        > 3
    {
        return Err(AppError::StateUnavailable);
    }
    Ok(template)
}

fn task_from_row(row: TaskRow, template: &TaskTemplate) -> Result<TaskDetail, AppError> {
    let input_answers: BTreeMap<String, Value> =
        serde_json::from_str(&row.input_answers_json).map_err(|_| AppError::StateUnavailable)?;
    let questions = questions_for(template, &input_answers);
    if questions.len() as u32 != row.question_count && row.status != "completed" {
        return Err(AppError::StateUnavailable);
    }
    Ok(TaskDetail {
        id: row.id,
        workspace_id: row.workspace_id,
        template_id: row.template_id,
        template_version: row.template_version,
        kind: parse_task_kind(&row.task_kind)?,
        desired_result_type: parse_result_type(&row.desired_result_type)?,
        status: parse_task_status(&row.status)?,
        input_answers,
        questions: if row.status == "completed" {
            Vec::new()
        } else {
            questions
        },
        result_id: row.result_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
    })
}

fn parse_task_kind(value: &str) -> Result<TaskKind, AppError> {
    match value {
        "write" => Ok(TaskKind::Write),
        "modify" => Ok(TaskKind::Modify),
        "organize" => Ok(TaskKind::Organize),
        "analyze" => Ok(TaskKind::Analyze),
        _ => Err(AppError::StateUnavailable),
    }
}

fn parse_task_status(value: &str) -> Result<TaskStatus, AppError> {
    match value {
        "draft" => Ok(TaskStatus::Draft),
        "awaiting_input" => Ok(TaskStatus::AwaitingInput),
        "ready" => Ok(TaskStatus::Ready),
        "running" => Ok(TaskStatus::Running),
        "review_pending" => Ok(TaskStatus::ReviewPending),
        "completed" => Ok(TaskStatus::Completed),
        "failed" => Ok(TaskStatus::Failed),
        "cancelled" => Ok(TaskStatus::Cancelled),
        _ => Err(AppError::StateUnavailable),
    }
}

fn parse_result_type(value: &str) -> Result<ResultType, AppError> {
    match value {
        "document" => Ok(ResultType::Document),
        _ => Err(AppError::StateUnavailable),
    }
}

fn task_kind_value(value: TaskKind) -> &'static str {
    match value {
        TaskKind::Write => "write",
        TaskKind::Modify => "modify",
        TaskKind::Organize => "organize",
        TaskKind::Analyze => "analyze",
    }
}

fn task_status_value(value: TaskStatus) -> &'static str {
    match value {
        TaskStatus::Draft => "draft",
        TaskStatus::AwaitingInput => "awaiting_input",
        TaskStatus::Ready => "ready",
        TaskStatus::Running => "running",
        TaskStatus::ReviewPending => "review_pending",
        TaskStatus::Completed => "completed",
        TaskStatus::Failed => "failed",
        TaskStatus::Cancelled => "cancelled",
    }
}
