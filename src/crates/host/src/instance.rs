//! One copy of the app at a time (`agent_hud_runtime::instance`).
//!
//! The lock is claimed before Tauri starts, so a copy that is turned away
//! never opens a window or reads anything the running copy uses. A second
//! launch of the same executable brings the running copy forward instead of
//! asking the user to find it (agent-hud-native-open only says it runs); a launch of
//! another build that holds the lock, such as a test build while the
//! installed one runs, says which one runs, as agent-hud-native-open does. Demos
//! take no lock: they keep their own preferences and collect nothing.
use agent_hud_runtime::instance::{self, Claim, InstanceLock};
use std::path::{Path, PathBuf};

pub(crate) enum Launch {
    /// Run, keeping the lock (None when no lock could be taken here).
    Run(Option<InstanceLock>),
    /// This executable already runs: the lock to ask it to come forward at.
    HandOver(PathBuf),
    /// Another build runs; the executable it runs, when the lock names it.
    Refused(Option<PathBuf>),
}

pub(crate) fn claim(owns_hooks: bool) -> Launch {
    let path = match agent_hud_runtime::instance_lock(owns_hooks) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("No instance lock: {error}");
            return Launch::Run(None);
        }
    };
    let executable = std::env::current_exe().ok();
    match instance::claim(&path, executable.as_deref()) {
        Claim::Acquired(lock) => Launch::Run(Some(lock)),
        Claim::Unavailable(error) => {
            eprintln!("No instance lock at {error}");
            Launch::Run(None)
        }
        // A holder that cannot be named (not written yet, or unreadable while
        // locked on Windows) is taken to be this executable.
        Claim::Held(None) => Launch::HandOver(path),
        Claim::Held(Some(holder)) if same_file(&holder, executable.as_deref()) => {
            Launch::HandOver(path)
        }
        Claim::Held(Some(holder)) => Launch::Refused(Some(holder)),
    }
}

fn same_file(a: &Path, b: Option<&Path>) -> bool {
    let canonical = |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
    b.is_some_and(|b| canonical(a) == canonical(b))
}

/// Asks the running copy to show itself; true when it answered.
pub(crate) fn hand_over(lock: &Path) -> bool {
    instance::hand_over(lock)
}

/// Says which copy runs and that it must quit first. In the system's
/// language, since the stored preferences are not read before the claim.
pub(crate) fn refuse(holder: Option<&Path>) {
    let chinese = crate::shell::system_prefers_chinese();
    let text = |zh: &str, en: &str| {
        if chinese {
            zh.to_owned()
        } else {
            en.to_owned()
        }
    };
    let body = match holder {
        Some(holder) => {
            let place = abbreviated(&instance::application(holder));
            text(
                &format!("正在运行的是 {place}。请先退出它，再打开这一个。"),
                &format!("{place} is running. Quit it first, then open this one."),
            )
        }
        None => text(
            "请先退出正在运行的 Agent HUD，再打开这一个。",
            "Quit the Agent HUD that is running first, then open this one.",
        ),
    };
    crate::shell::alert(
        &text("Agent HUD 已在运行", "Agent HUD is already running"),
        &body,
        &text("好", "OK"),
    );
}

fn abbreviated(path: &Path) -> String {
    let home = agent_hud_runtime::home_directory().ok();
    match home
        .as_deref()
        .and_then(|home| path.strip_prefix(home).ok())
    {
        Some(rest) => Path::new("~").join(rest).display().to_string(),
        None => path.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_launch_hands_over_to_this_executable_and_refuses_another_build() {
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("AGENTHUD_NEXT_DATA_DIR", temp.path());
        let Launch::Run(Some(_lock)) = claim(false) else {
            panic!("the first copy runs and keeps the lock");
        };
        assert!(
            matches!(claim(false), Launch::HandOver(_)),
            "the same executable comes forward"
        );
        // Another build's name in the lock. Windows keeps others from writing
        // a locked file, and from reading it, so there it stays a hand-over.
        let other = "/Applications/Agent HUD.app/Contents/MacOS/Agent HUD";
        if std::fs::write(temp.path().join("instance.lock"), other).is_ok() {
            match claim(false) {
                Launch::Refused(Some(holder)) => assert_eq!(holder, Path::new(other)),
                _ => panic!("another build is named and refused"),
            }
        }
    }
}
