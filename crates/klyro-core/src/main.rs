//! klyro-core: the always-on daemon.
//!
//! One small process that owns the hot path — the hotkey, the capture, the
//! provider call and the answer — so that opening the overlay costs a native
//! window and not a browser. The Electron app is its control panel.

mod protocol;
mod provider;
mod server;

use std::process::ExitCode;

use tokio::net::UnixListener;

/// Is a daemon already listening on this socket?
fn daemon_is_answering(socket: &std::path::Path) -> bool {
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    let Ok(mut stream) = UnixStream::connect(socket) else {
        return false;
    };
    // The daemon says hello first, so anything at all means it is alive.
    let _ = stream.write_all(b"{\"kind\":\"ping\"}\n");
    stream.flush().is_ok()
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let socket = server::socket_path();
    if let Some(parent) = socket.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            tracing::error!(%error, "could not create the state directory");
            return ExitCode::FAILURE;
        }
    }
    // Another daemon may already be running: if its socket answers, this
    // process has nothing to do. (Removing a live socket would orphan the
    // daemon behind it.)
    if socket.exists() && daemon_is_answering(&socket) {
        tracing::info!("another daemon is already running");
        return ExitCode::SUCCESS;
    }
    // A socket left behind by a crash would stop the daemon from starting.
    let _ = std::fs::remove_file(&socket);

    let listener = match UnixListener::bind(&socket) {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%error, path = %socket.display(), "could not listen");
            return ExitCode::FAILURE;
        }
    };
    // Only this user may talk to the daemon.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600)) {
            tracing::warn!(%error, "could not lock the socket down");
        }
    }

    if let Err(error) = server::serve(listener, &socket).await {
        tracing::error!(%error, "the daemon stopped");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
