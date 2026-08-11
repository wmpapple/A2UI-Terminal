use super::protocol::A2uiAction;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionRisk {
    Low,
    Medium,
    High,
}

impl ActionRisk {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionDecision {
    Allowed,
    ReviewRequired,
    Denied,
}

impl ActionDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::ReviewRequired => "review_required",
            Self::Denied => "denied",
        }
    }
}

pub struct PolicyOutcome {
    pub risk: ActionRisk,
    pub decision: ActionDecision,
    pub message: &'static str,
}

pub fn evaluate(action: &A2uiAction) -> PolicyOutcome {
    match action.action_type.as_str() {
        "set_state" => PolicyOutcome {
            risk: ActionRisk::Low,
            decision: ActionDecision::Allowed,
            message: "UI 状态已更新",
        },
        "submit_form" => PolicyOutcome {
            risk: ActionRisk::Low,
            decision: ActionDecision::Allowed,
            message: "表单事件已记录，未发送到外部服务",
        },
        "request_patch" => PolicyOutcome {
            risk: ActionRisk::Medium,
            decision: ActionDecision::ReviewRequired,
            message: "文件类操作必须进入 Diff 审阅",
        },
        _ => PolicyOutcome {
            risk: ActionRisk::High,
            decision: ActionDecision::Denied,
            message: "Action 未授权，已默认拒绝",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(action_type: &str) -> A2uiAction {
        A2uiAction {
            action_type: action_type.into(),
            target: None,
            value: None,
        }
    }

    #[test]
    fn defaults_to_deny_and_routes_file_changes_to_review() {
        assert_eq!(
            evaluate(&action("run_command")).decision,
            ActionDecision::Denied
        );
        assert_eq!(
            evaluate(&action("request_patch")).decision,
            ActionDecision::ReviewRequired
        );
        assert_eq!(
            evaluate(&action("set_state")).decision,
            ActionDecision::Allowed
        );
    }
}
