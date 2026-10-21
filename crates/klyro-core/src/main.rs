//! klyro-core: the always-on daemon.
//!
//! One small process that owns the hot path — the hotkey, the capture, the
//! provider call, the answer — so that opening the overlay costs a native
//! window and not a browser. The Electron app is its control panel.

mod protocol;
mod provider;
mod server;

use std::io::Write;
use std::process::ExitCode;

use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let state_path = server::state_path();
    if let Some(parent) = state_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            tracing::error!(%error, "could not create the state directory");
            return ExitCode::FAILURE;
        }
    }

    // Another daemon may already be running: if its state file names a daemon
    // that still answers, this process has nothing to do.
    if state_path.exists() && daemon_is_answering(&state_path) {
        tracing::info!("another daemon is already running");
        return ExitCode::SUCCESS;
    }

    // The loopback interface, on a port the operating system picks. The token
    // is what actually protects it: a client that cannot present it gets
    // nothing.
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%error, "could not listen");
            return ExitCode::FAILURE;
        }
    };
    let port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(_) => 0,
    };
    let token = random_token();
    if let Err(error) = write_state_file(&state_path, port, &token) {
        tracing::error!(%error, "could not write the state file");
        return ExitCode::FAILURE;
    }

    tracing::info!(port, pid = std::process::id(), "klyro-core listening");
    let result = server::serve(listener, token).await;
    let _ = std::fs::remove_file(&state_path);
    if let Err(error) = result {
        tracing::error!(%error, "the daemon stopped");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// A token for the client to present.
fn random_token() -> String {
    let mut bytes = [0u8; 32];
    if getrandom::getrandom(&mut bytes).is_err() {
        // A weak token is better than no daemon: the loopback interface is
        // still the first line of defence.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        return format!("{:032x}-{}", nanos, std::process::id());
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Write where the daemon is, so the app can find it.
fn write_state_file(path: &std::path::Path, port: u16, token: &str) -> std::io::Result<()> {
    let body = serde_json::json!({
        "port": port,
        "token": token,
        "pid": std::process::id(),
        "version": server::VERSION,
    });
    let mut file = std::fs::File::create(path)?;
    file.write_all(serde_json::to_string(&body)?.as_bytes())?;
    file.flush()?;
    // Only this user may read it: it holds the token.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Is the daemon in this state file still answering?
fn daemon_is_answering(path: &std::path::Path) -> bool {
    let Ok(body) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(state) = serde_json::from_str::<serde_json::Value>(&body) else {
        return false;
    };
    let (Some(port), Some(token)) = (state.get("port"), state.get("token")) else {
        return false;
    };
    let (Some(port), Some(token)) = (port.as_u64(), token.as_str()) else {
        return false;
    };
    // A quick connect is enough: the daemon answers the token and then hangs up.
    std::net::TcpStream::connect(("127.0.0.1", port as u16)).is_ok()
}
