//! Protocol-specific tests for the local-agent clients.
//!
//! Each agent has its own protocol, and each is easy to get subtly wrong:
//! the OpenCode server's turn ends with an `idle` entry, the Claude Code CLI
//! answers on stdout as JSON lines, and the Antigravity service is
//! Connect-RPC over HTTP/1.1 with a CSRF token.
//!
//! These tests speak each protocol against a fake of the real thing, so a
//! change that breaks one of them fails here and not in a meeting.

use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::provider::antigravity::Antigravity;
use crate::provider::cli::{ClaudeCode, Codex};
use crate::provider::opencode::OpenCode;
use crate::provider::Chunk;
use crate::protocol::ImageInput;

/// Read a whole HTTP request (the headers and the body) off a socket.
async fn read_request(stream: &mut tokio::net::TcpStream) -> String {
    let mut buffer = vec![0u8; 64 * 1024];
    let read = stream.read(&mut buffer).await.unwrap_or(0);
    String::from_utf8_lossy(&buffer[..read]).to_string()
}

/// A fake OpenCode server: the v2 session API, in miniature.
async fn fake_opencode(answer: &'static str) -> (u16, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            let method = request.lines().next().unwrap_or("").split(' ').next().unwrap_or("");
            // Reads are GET, writes are POST; anything else is refused the
            // way the real server refuses it.
            let ok_method = if request.contains("/api/model")
                || request.contains("/message")
            {
                method == "GET"
            } else {
                method == "POST"
            };
            if !ok_method {
                let response = "HTTP/1.1 405 Method Not Allowed\r\ncontent-length: 0\r\n\r\n";
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.flush().await;
                continue;
            }
            let body = if request.contains("/api/session?")
                || request.contains("/message")
            {
                // The session's messages: the question, the answer, and the
                // entry that says the turn is over.
                format!(
                    "{{\"data\":[\
                      {{\"id\":\"msg_idle\",\"type\":\"idle\",\"outcome\":\"succeeded\",\"time\":{{\"created\":3}}}},\
                      {{\"id\":\"msg_1\",\"type\":\"assistant\",\"time\":{{\"created\":2}},\"content\":[{{\"type\":\"text\",\"text\":\"{answer}\"}}]}},\
                      {{\"id\":\"msg_0\",\"type\":\"user\",\"time\":{{\"created\":1}},\"content\":[{{\"type\":\"text\",\"text\":\"the question\"}}]}}\
                     ]}}"
                )
            } else if request.contains("/api/session") && request.contains("POST") {
                "{\"data\":{\"id\":\"ses_1\"}}".to_string()
            } else if request.contains("/api/model") {
                "{\"data\":[{\"id\":\"qwen3\",\"modelID\":\"qwen3\",\"name\":\"Qwen 3\",\"providerID\":\"opencode\"}]}"
                    .to_string()
            } else {
                "{\"data\":{\"id\":\"ses_1\"}}".to_string()
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.flush().await;
        }
    });
    (port, handle)
}

#[tokio::test]
async fn opencode_asks_a_session_and_reads_the_answer_back() {
    let (port, _server) = fake_opencode("the answer").await;
    let client = OpenCode::new(&format!("http://127.0.0.1:{port}"), Some("secret".into()));

    let mut stream = client
        .ask("qwen3", "the question", &[])
        .await
        .expect("the ask should start");
    use futures_util::StreamExt;
    let mut answer = String::new();
    while let Some(chunk) = stream.next().await {
        match chunk.expect("a chunk") {
            Chunk::Text(text) => answer.push_str(&text),
            Chunk::Done => break,
        }
    }
    assert_eq!(answer, "the answer");
}

#[tokio::test]
async fn opencode_lists_its_models() {
    let (port, _server) = fake_opencode("x").await;
    let client = OpenCode::new(&format!("http://127.0.0.1:{port}"), None);
    let models = client.models().await.expect("the catalogue");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "qwen3");
    assert_eq!(models[0].provider, "opencode");
}

/// A fake Claude Code CLI: it answers with the JSON lines the real one writes.
fn fake_claude_code(answer: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("klyro-fake-claude-{}", std::process::id()));
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\n\
             cat > /dev/null 2>&1 || true\n\
             printf '%s\\n' '{answer}'\n\
             printf '%s\\n' '{{\"type\":\"assistant\",\"message\":{{\"content\":[{{\"type\":\"text\",\"text\":\"{answer}\"}}]}}}}'\n\
             printf '%s\\n' '{{\"type\":\"result\",\"is_error\":false,\"result\":\"{answer}\"}}'\n",
            answer = answer
        ),
    )
    .expect("write the fake CLI");
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    path
}

#[tokio::test]
async fn claude_code_runs_the_cli_and_reads_its_answer() {
    let path = fake_claude_code("the cli answer");
    let client = ClaudeCode::new(path.to_str().expect("path"));
    let mut stream = client.ask("sonnet", "the question", &[]).await.expect("the ask starts");
    use futures_util::StreamExt;
    let mut answer = String::new();
    while let Some(chunk) = stream.next().await {
        match chunk.expect("a chunk") {
            Chunk::Text(text) => answer.push_str(&text),
            Chunk::Done => break,
        }
    }
    let _ = std::fs::remove_file(&path);
    assert!(answer.contains("the cli answer"), "the answer was {answer}");
}

/// A fake Codex CLI: it writes the final message on stdout.
fn fake_codex(answer: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("klyro-fake-codex-{}", std::process::id()));
    std::fs::write(&path, format!("#!/bin/sh\nprintf '%s\\n' '{answer}'\n")).expect("write");
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    path
}

#[tokio::test]
async fn codex_runs_the_cli_and_reads_its_answer() {
    let path = fake_codex("the codex answer");
    let client = Codex::new(path.to_str().expect("path"));
    let mut stream = client.ask("gpt-5-codex", "the question", &[]).await.expect("the ask starts");
    use futures_util::StreamExt;
    let mut answer = String::new();
    while let Some(chunk) = stream.next().await {
        match chunk.expect("a chunk") {
            Chunk::Text(text) => answer.push_str(&text),
            Chunk::Done => break,
        }
    }
    let _ = std::fs::remove_file(&path);
    assert!(answer.contains("the codex answer"), "the answer was {answer}");
}

/// A fake Antigravity service: Connect-RPC over HTTP/1.1.
async fn fake_antigravity(answer: &'static str) -> (u16, Arc<std::sync::Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = Arc::clone(&seen);
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            recorded.lock().expect("lock").push(request.clone());
            let body = format!("{{\"response\":\"{answer}\"}}");
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.flush().await;
        }
    });
    (port, seen)
}

#[tokio::test]
async fn antigravity_sends_the_token_and_asks_over_connect_rpc() {
    let (port, seen) = fake_antigravity("the antigravity answer").await;
    let client = Antigravity::new(port, "the-csrf-token");
    let mut stream = client
        .ask("MODEL_PLACEHOLDER_M26", "the question")
        .await
        .expect("the ask starts");
    use futures_util::StreamExt;
    let mut answer = String::new();
    while let Some(chunk) = stream.next().await {
        match chunk.expect("a chunk") {
            Chunk::Text(text) => answer.push_str(&text),
            Chunk::Done => break,
        }
    }
    assert_eq!(answer, "the antigravity answer");

    let requests = seen.lock().expect("lock").clone();
    let request = requests.first().expect("a request");
    assert!(request.contains("/exa.language_server_pb.LanguageServerService/GetModelResponse"));
    assert!(request.contains("x-codeium-csrf-token: the-csrf-token"));
    assert!(request.contains("connect-protocol-version: 1"));
    assert!(request.contains("MODEL_PLACEHOLDER_M26"));
    assert!(request.contains("the question"));
}

#[tokio::test]
async fn the_claude_code_cli_is_given_the_picture_when_there_is_one() {
    let path = std::env::temp_dir().join(format!("klyro-fake-claude-img-{}", std::process::id()));
    // The fake records what it was given on stdin.
    let record = path.with_extension("seen");
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\ncat > {record}\nprintf '%s\\n' '{{\"type\":\"result\",\"is_error\":false,\"result\":\"ok\"}}'\n",
            record = record.display()
        ),
    )
    .expect("write");
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");

    let client = ClaudeCode::new(path.to_str().expect("path"));
    let images = vec![ImageInput {
        data_url: "data:image/png;base64,AAAA".to_string(),
        mime: "image/png".to_string(),
    }];
    let mut stream = client.ask("sonnet", "what is this?", &images).await.expect("the ask starts");
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        if let Chunk::Done = chunk.expect("a chunk") {
            break;
        }
    }
    let seen = std::fs::read_to_string(&record).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&record);
    // The CLI is given the raw base64 and the media type, not the data URL.
    assert!(seen.contains("\"data\":\"AAAA\""), "the CLI was given {seen}");
    assert!(seen.contains("\"media_type\":\"image/png\""), "the CLI was given {seen}");
    assert!(seen.contains("image"), "the CLI was given {seen}");
}

/// A fake OpenCode server whose turn fails, the way the real one reports it.
async fn fake_opencode_failed(reason: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            let body = if request.contains("/message") {
                format!(
                    "{{\"data\":[\
                      {{\"id\":\"msg_idle\",\"type\":\"idle\",\"outcome\":\"failed\",\"error\":{{\"message\":\"{reason}\"}},\"time\":{{\"created\":3}}}},\
                      {{\"id\":\"msg_0\",\"type\":\"user\",\"time\":{{\"created\":1}},\"content\":[{{\"type\":\"text\",\"text\":\"the question\"}}]}}\
                     ]}}"
                )
            } else {
                "{\"data\":{\"id\":\"ses_1\"}}".to_string()
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.flush().await;
        }
    });
    port
}

#[tokio::test]
async fn opencode_reports_the_servers_own_reason_when_a_turn_fails() {
    let port = fake_opencode_failed("the model is not available").await;
    let client = OpenCode::new(&format!("http://127.0.0.1:{port}"), None);
    let mut stream = client
        .ask("gone-model", "the question", &[])
        .await
        .expect("the ask should start");
    use futures_util::StreamExt;
    let mut failure = String::new();
    while let Some(chunk) = stream.next().await {
        if let Err(message) = chunk {
            failure = message;
            break;
        }
    }
    assert!(
        failure.contains("the model is not available"),
        "the reason was {failure:?}"
    );
}

/// A fake OpenCode server whose model thinks before it speaks: the session is
/// read many times with nothing in it, and only then does the answer appear.
async fn fake_opencode_slow(answer: &'static str, silent_reads: usize) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = Arc::clone(&reads);
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            let body = if request.contains("/message") {
                let seen = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if seen < silent_reads {
                    // The prompt is queued; the model has not said anything
                    // yet. There is no `idle` entry, because the turn is not
                    // over.
                    "{\"data\":[{\"id\":\"msg_0\",\"type\":\"user\",\"time\":{\"created\":1},\"content\":[{\"type\":\"text\",\"text\":\"q\"}]}]}".to_string()
                } else {
                    format!(
                        "{{\"data\":[\
                          {{\"id\":\"msg_idle\",\"type\":\"idle\",\"outcome\":\"succeeded\",\"time\":{{\"created\":3}}}},\
                          {{\"id\":\"msg_1\",\"type\":\"assistant\",\"time\":{{\"created\":2}},\"content\":[{{\"type\":\"text\",\"text\":\"{answer}\"}}]}},\
                          {{\"id\":\"msg_0\",\"type\":\"user\",\"time\":{{\"created\":1}},\"content\":[{{\"type\":\"text\",\"text\":\"q\"}}]}}\
                         ]}}"
                    )
                }
            } else {
                "{\"data\":{\"id\":\"ses_1\"}}".to_string()
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.flush().await;
        }
    });
    port
}

#[tokio::test]
async fn a_model_that_thinks_before_it_speaks_is_waited_for() {
    // Twenty reads of silence, which is longer than the three seconds a short
    // window would allow. The turn is not over until the server says so.
    let port = fake_opencode_slow("a considered answer", 20).await;
    let client = OpenCode::new(&format!("http://127.0.0.1:{port}"), None).with_poll_ms(2);
    let mut stream = client
        .ask("slow-model", "the question", &[])
        .await
        .expect("the ask should start");
    use futures_util::StreamExt;
    let mut answer = String::new();
    while let Some(chunk) = stream.next().await {
        match chunk.expect("a chunk") {
            Chunk::Text(text) => answer.push_str(&text),
            Chunk::Done => break,
        }
    }
    assert_eq!(answer, "a considered answer");
}
