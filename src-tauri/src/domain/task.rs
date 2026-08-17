use crate::domain::result::{ResultDetail, ResultType};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskKind {
    Write,
    Modify,
    Organize,
    Analyze,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Draft,
    AwaitingInput,
    Ready,
    Running,
    ReviewPending,
    Completed,
    Failed,
    Cancelled,
}

impl TaskStatus {
    pub fn can_transition_to(self, next: Self) -> bool {
        use TaskStatus::*;
        self == next
            || matches!(
                (self, next),
                (Draft, AwaitingInput | Ready | Cancelled)
                    | (AwaitingInput, Ready | Cancelled)
                    | (Ready, Running | Cancelled)
                    | (Running, ReviewPending | Completed | Failed | Cancelled)
                    | (ReviewPending, Running | Completed | Failed | Cancelled)
                    | (Failed, Ready | Running | Cancelled)
            )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateField {
    pub id: String,
    pub label: String,
    pub kind: TemplateFieldKind,
    pub required: bool,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub default_value: Option<Value>,
    #[serde(default)]
    pub max_length: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TemplateFieldKind {
    ShortText,
    Select,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskTemplate {
    pub id: String,
    pub version: u32,
    pub name: String,
    pub description: String,
    pub kind: TaskKind,
    pub desired_result_type: ResultType,
    pub fields: Vec<TemplateField>,
    pub default_sections: Vec<String>,
    pub risk_level: String,
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskQuestion {
    pub field_id: String,
    pub prompt: String,
    pub kind: TemplateFieldKind,
    pub options: Vec<String>,
    pub required: bool,
    pub max_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub id: String,
    pub workspace_id: String,
    pub template_id: String,
    pub template_version: u32,
    pub kind: TaskKind,
    pub desired_result_type: ResultType,
    pub status: TaskStatus,
    pub input_answers: BTreeMap<String, Value>,
    pub questions: Vec<TaskQuestion>,
    pub result_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTaskInput {
    pub workspace_id: String,
    pub template_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnswerTaskInput {
    pub task_id: String,
    pub answers: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunResult {
    pub task: TaskDetail,
    pub result: ResultDetail,
    pub output_mode: String,
}

pub fn validate_answers(
    template: &TaskTemplate,
    answers: &BTreeMap<String, Value>,
) -> Result<(), AppError> {
    for (key, value) in answers {
        let field = template
            .fields
            .iter()
            .find(|field| field.id == *key)
            .ok_or_else(|| AppError::InvalidInput(format!("模板不接受字段：{key}")))?;
        let text = value
            .as_str()
            .ok_or_else(|| AppError::InvalidInput(format!("{} 必须是文本", field.label)))?;
        if text.trim().is_empty() {
            return Err(AppError::InvalidInput(format!("{} 不能为空", field.label)));
        }
        if let Some(limit) = field.max_length {
            if text.chars().count() > limit as usize {
                return Err(AppError::InvalidInput(format!(
                    "{} 不能超过 {} 个字符",
                    field.label, limit
                )));
            }
        }
        if field.kind == TemplateFieldKind::Select && !field.options.iter().any(|v| v == text) {
            return Err(AppError::InvalidInput(format!(
                "{} 不是允许的选项",
                field.label
            )));
        }
    }
    Ok(())
}

pub fn questions_for(
    template: &TaskTemplate,
    answers: &BTreeMap<String, Value>,
) -> Vec<TaskQuestion> {
    template
        .fields
        .iter()
        .filter(|field| {
            field.required
                && field.default_value.is_none()
                && !answers
                    .get(&field.id)
                    .is_some_and(|value| value.as_str().is_some_and(|text| !text.trim().is_empty()))
        })
        .take(3)
        .map(|field| TaskQuestion {
            field_id: field.id.clone(),
            prompt: format!("请提供{}", field.label),
            kind: field.kind,
            options: field.options.clone(),
            required: true,
            max_length: field.max_length,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_state_machine_rejects_shortcuts() {
        assert!(TaskStatus::AwaitingInput.can_transition_to(TaskStatus::Ready));
        assert!(TaskStatus::Ready.can_transition_to(TaskStatus::Running));
        assert!(TaskStatus::Running.can_transition_to(TaskStatus::Completed));
        assert!(!TaskStatus::AwaitingInput.can_transition_to(TaskStatus::Completed));
        assert!(!TaskStatus::Completed.can_transition_to(TaskStatus::Running));
    }
}
