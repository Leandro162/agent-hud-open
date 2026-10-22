//! Windows pieces of the LAN link: partly implemented.
//!
//! - The listener is nonblocking and polls every 25 ms, so it needs no wake-up.
//! - Interface addresses are not listed yet (GetAdaptersAddresses), so the
//!   pairing endpoint has no host to show.
//! - Directories and files take the user profile's inherited ACL; no protected
//!   owner-only DACL is applied yet.
use crate::Result;
use std::{fs, net::TcpListener, path::Path};

pub(crate) enum Wait {
    Accept,
    #[allow(dead_code)]
    Stop,
    #[allow(dead_code)]
    Retry,
}

pub(crate) struct Waiter;
pub(crate) struct Wake;

pub(crate) fn wake_pair() -> Result<(Waiter, Wake)> {
    Ok((Waiter, Wake))
}

impl Wake {
    pub(crate) fn wake(self) {}
}

/// The nonblocking accept itself polls; the stop flag ends the loop.
pub(crate) fn wait(_listener: &TcpListener, _waiter: &Waiter) -> Wait {
    Wait::Accept
}

pub(crate) fn addresses() -> Vec<String> {
    Vec::new()
}

pub(crate) fn protect_directory(_path: &Path) -> Result<()> {
    Ok(())
}

pub(crate) fn private_file(_options: &mut fs::OpenOptions) {}
