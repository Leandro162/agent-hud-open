//! The lock that lets one copy of the app run at a time.
//!
//! A copy that runs collects into its data directory and, when it owns client
//! hooks, points every client's hooks at itself, so a second copy would write
//! the same database and take the hooks from under the first. The lock is an
//! advisory whole-file lock (`flock` on macOS and Linux, `LockFileEx` on
//! Windows), the same kind agent-hud-native-open's `InstanceLock` takes, so the two
//! apps see each other's. The system lets go of it when the process ends,
//! also when it crashes, so a copy that is gone never keeps another from
//! starting. Hook commands, the MCP relay and demos take no lock.
//!
//! The copy that holds the lock also listens beside it (`endpoint`), so a
//! second launch of the same app can ask it to come forward. Only the holder
//! ever listens there, so two launches never race for the endpoint.
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

// A Unix socket beside the lock, or a named pipe on Windows.
#[cfg(unix)]
#[path = "unix.rs"]
mod endpoint;
#[cfg(windows)]
#[path = "windows.rs"]
mod endpoint;

pub type OnShow = Arc<dyn Fn() + Send + Sync>;

pub enum Claim {
    /// This process holds the lock for as long as it keeps the value.
    Acquired(InstanceLock),
    /// Another process holds it: the executable it runs, if the lock names it.
    Held(Option<PathBuf>),
    /// No lock could be taken here; the app runs without one rather than not
    /// at all.
    Unavailable(String),
}

pub struct InstanceLock {
    path: PathBuf,
    _file: File,
}

/// The lock of the copy that runs, and the endpoint where a second launch
/// asks it to come forward.
pub struct Running {
    _lock: InstanceLock,
    _endpoint: Option<endpoint::Endpoint>,
}

impl InstanceLock {
    /// Listens for a second launch's `hand_over` and calls `on_show` for each.
    /// Without an endpoint the lock still holds; a second launch then says
    /// which copy runs instead of bringing it forward.
    pub fn listen(self, on_show: OnShow) -> Running {
        let endpoint = endpoint::listen(&self.path, on_show)
            .inspect_err(|error| {
                eprintln!(
                    "No hand-over endpoint beside {}: {error}",
                    self.path.display()
                )
            })
            .ok();
        Running {
            _lock: self,
            _endpoint: endpoint,
        }
    }
}

/// Asks the copy that holds the lock at `path` to come forward; true when it
/// answered.
pub fn hand_over(path: &Path) -> bool {
    endpoint::hand_over(path)
}

/// Takes the lock at `path` and writes `executable` into it, so that a launch
/// it turns away can say which copy runs.
pub fn claim(path: &Path, executable: Option<&Path>) -> Claim {
    if let Some(parent) = path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return Claim::Unavailable(format!("{}: {error}", parent.display()));
        }
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    crate::os::private_file(&mut options);
    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) => return Claim::Unavailable(format!("{}: {error}", path.display())),
    };
    match file.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return Claim::Held(holder(path)),
        Err(TryLockError::Error(error)) => {
            return Claim::Unavailable(format!("{}: {error}", path.display()))
        }
    }
    let name = executable
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    let written = file.set_len(0).is_ok()
        && file.seek(SeekFrom::Start(0)).is_ok()
        && file.write_all(name.as_bytes()).is_ok();
    if !written {
        eprintln!(
            "Could not name this copy in the instance lock {}",
            path.display()
        );
    }
    Claim::Acquired(InstanceLock {
        path: path.to_owned(),
        _file: file,
    })
}

/// The executable the holder of `path` wrote; None when the holder has not
/// written it yet, or the file cannot be read while it is locked (Windows).
pub fn holder(path: &Path) -> Option<PathBuf> {
    let mut text = String::new();
    File::open(path)
        .ok()?
        .take(4096)
        .read_to_string(&mut text)
        .ok()?;
    let executable = PathBuf::from(text.trim());
    executable.is_absolute().then_some(executable)
}

/// The application an executable belongs to, as a person would find it:
/// `…/Name.app` for one inside a macOS bundle, else the executable itself.
pub fn application(executable: &Path) -> PathBuf {
    let folder = executable.parent();
    let contents = folder.and_then(Path::parent);
    let bundle = contents.and_then(Path::parent);
    let in_bundle = folder
        .and_then(Path::file_name)
        .is_some_and(|name| name == "MacOS")
        && contents
            .and_then(Path::file_name)
            .is_some_and(|name| name == "Contents")
        && bundle
            .and_then(Path::extension)
            .is_some_and(|extension| extension == "app");
    match bundle {
        Some(bundle) if in_bundle => bundle.to_path_buf(),
        _ => executable.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_held_lock_turns_the_next_claim_away_and_names_the_holder() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("app.agenthud/instance.lock");
        let running = Path::new("/Applications/Agent HUD.app/Contents/MacOS/Agent HUD");
        let Claim::Acquired(first) = claim(&path, Some(running)) else {
            panic!("the first claim takes the lock");
        };
        match claim(&path, Some(Path::new("/tmp/agent-hud"))) {
            // Windows keeps a locked file from being read by anyone else.
            Claim::Held(holder) => {
                if let Some(holder) = holder {
                    assert_eq!(holder, running);
                    assert_eq!(
                        application(&holder),
                        Path::new("/Applications/Agent HUD.app")
                    );
                }
            }
            _ => panic!("a second claim is turned away"),
        }
        drop(first);
        let Claim::Acquired(_second) = claim(&path, Some(Path::new("/usr/local/bin/agent-hud")))
        else {
            panic!("the lock is free once its holder lets go");
        };
        drop(_second);
        assert_eq!(
            holder(&path).as_deref(),
            Some(Path::new("/usr/local/bin/agent-hud")),
            "the new holder replaces the old name"
        );
    }

    #[test]
    fn a_second_launch_brings_the_holder_forward() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("instance.lock");
        assert!(!hand_over(&path), "nobody answers before a copy runs");
        let Claim::Acquired(lock) = claim(&path, None) else {
            panic!("the first claim takes the lock");
        };
        let shown = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = shown.clone();
        let _running = lock.listen(Arc::new(move || {
            count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }));
        assert!(hand_over(&path));
        assert!(hand_over(&path));
        assert_eq!(shown.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn executables_outside_a_bundle_name_themselves() {
        let tool = Path::new("/usr/local/bin/agent-hud");
        assert_eq!(application(tool), tool);
        let loose = Path::new("/tmp/MacOS/agent-hud");
        assert_eq!(application(loose), loose);
    }

    #[test]
    fn a_lock_that_cannot_be_made_lets_the_app_run() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("file");
        fs::write(&file, "").unwrap();
        assert!(matches!(
            claim(&file.join("instance.lock"), None),
            Claim::Unavailable(_)
        ));
    }
}
