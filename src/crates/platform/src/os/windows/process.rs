//! Windows process ancestry through the local Win32_Process provider. Read only
//! this user's parents, stop at a reused PID, and never read process environments.
use super::super::ProcessAncestor;
use serde::Deserialize;
use std::{
    collections::HashMap,
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Deserialize)]
struct Parent {
    executable: PathBuf,
    command: String,
}

pub(crate) fn parent_processes() -> Vec<ProcessAncestor> {
    let Some(system) = std::env::var_os("SystemRoot") else {
        return Vec::new();
    };
    let mut command =
        Command::new(PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    super::configure_command(&mut command);
    command
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
        .arg(include_str!(
            "../../../scripts/windows/parent-processes.ps1"
        ))
        .env("AGENT_HUD_CALLER_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let Ok(mut child) = command.spawn() else {
        return Vec::new();
    };
    let stdout = child.stdout.take().unwrap();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(1024 * 1024 + 1).read_to_end(&mut bytes);
        let _ = sender.send((result, bytes));
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    let Ok((Ok(_), bytes)) = receiver.recv_timeout(Duration::from_millis(100)) else {
        return Vec::new();
    };
    if !success || bytes.len() > 1024 * 1024 {
        return Vec::new();
    }
    String::from_utf8_lossy(&bytes)
        .lines()
        .take(16)
        .map_while(|line| {
            let parent = serde_json::from_str::<Parent>(line).ok()?;
            Some(ProcessAncestor {
                executable: parent.executable,
                arguments: arguments(&parent.command)?,
                bundle: None,
            })
        })
        .collect()
}

/// Decode the command line using Windows' native quoting rules.
fn arguments(command: &str) -> Option<Vec<String>> {
    use windows_sys::Win32::Foundation::LocalFree;
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn CommandLineToArgvW(command: *const u16, count: *mut i32) -> *mut *mut u16;
    }
    if command.is_empty() || command.contains('\0') {
        return None;
    }
    let command = command.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut count = 0;
    let values = unsafe { CommandLineToArgvW(command.as_ptr(), &mut count) };
    if values.is_null() {
        return None;
    }
    let mut result = Vec::new();
    for index in 0..count {
        let value = unsafe { *values.add(index as usize) };
        let mut length = 0;
        unsafe {
            while *value.add(length) != 0 {
                length += 1;
            }
            result.push(String::from_utf16_lossy(std::slice::from_raw_parts(
                value, length,
            )));
        }
    }
    unsafe { LocalFree(values.cast()) };
    Some(result)
}

/// Another process's environment is not read on Windows. A daemon-served Codex
/// TUI therefore has no terminal target from a listening port.
pub(crate) fn codex_cli_on_port(
    _port: u16,
    _wanted_env: &[&str],
) -> Option<(Vec<String>, HashMap<String, String>)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_argv_preserves_unicode_spaces_empty_values_and_backslashes() {
        assert_eq!(
            arguments(
                r#""C:\Program Files\Claude\claude.exe" --model "模型 one" "" "C:\my project\\""#
            ),
            Some(vec![
                r"C:\Program Files\Claude\claude.exe".into(),
                "--model".into(),
                "模型 one".into(),
                "".into(),
                "C:\\my project\\".into(),
            ])
        );
        assert!(arguments("").is_none());
        assert!(arguments("codex\0daemon").is_none());
    }

    #[test]
    fn ancestry_reads_the_same_user_parent_in_a_real_windows_process() {
        if std::env::var_os("AGENT_HUD_TEST_ANCESTRY_CHILD").is_some() {
            let parents = parent_processes();
            let parent = parents
                .first()
                .expect("the same-user test parent must be visible");
            assert_eq!(
                parent.executable.canonicalize().unwrap(),
                std::env::current_exe().unwrap().canonicalize().unwrap()
            );
            assert!(!parent.arguments.is_empty());
            return;
        }
        let name = format!(
            "{}::ancestry_reads_the_same_user_parent_in_a_real_windows_process",
            module_path!().split_once("::").unwrap().1
        );
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &name, "--nocapture"])
            .env("AGENT_HUD_TEST_ANCESTRY_CHILD", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
}
