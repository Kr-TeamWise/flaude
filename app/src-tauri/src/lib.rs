use std::io::{Write as IoWrite, BufRead, BufReader};
use std::process::{Command, ChildStdin};
use std::sync::Arc;
use tokio::sync::Mutex;
use once_cell::sync::Lazy;
use tauri::Emitter;

/// PID of the currently running agent subprocess (for cancellation).
static AGENT_PID: Lazy<Arc<Mutex<Option<u32>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Stdin handle for the running agent subprocess (for interject messages).
static AGENT_STDIN: Lazy<Arc<std::sync::Mutex<Option<ChildStdin>>>> = Lazy::new(|| Arc::new(std::sync::Mutex::new(None)));

/// WebSocket connection state
static WS_CONNECTED: Lazy<Arc<Mutex<bool>>> = Lazy::new(|| Arc::new(Mutex::new(false)));

/// Allowlist of known integration IDs to prevent injection.
const KNOWN_INTEGRATIONS: &[&str] = &[
    "gws", "github", "discord", "slack", "sentry", "linear", "notion", "figma",
];

/// Run a shell command via zsh and return stdout
fn shell(script: &str) -> Result<String, String> {
    let output = Command::new("zsh")
        .arg("-l")
        .arg("-c")
        .arg(script)
        .output()
        .map_err(|e| format!("shell error: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Command failed with exit code: {}", output.status)
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Resolve the path to agent-runner.ts relative to the binary.
fn runner_script_path() -> String {
    // In dev, look relative to src-tauri; in production, look relative to the binary
    let dev_path = concat!(env!("CARGO_MANIFEST_DIR"), "/sdk-runner/agent-runner.ts");
    if std::path::Path::new(dev_path).exists() {
        return dev_path.to_string();
    }
    // Fallback: assume sdk-runner is next to the binary
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("sdk-runner/agent-runner.ts");
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }
    dev_path.to_string()
}

/// Run SDK agent-runner.ts with the given JSON config via stdin.
/// Returns the raw JSON output string.
fn run_sdk_runner(sdk_config_json: &str) -> Result<String, String> {
    let script_path = runner_script_path();

    // Resolve tsx binary from sdk-runner/node_modules/.bin/
    let runner_dir = std::path::Path::new(&script_path).parent().unwrap_or(std::path::Path::new("."));
    let tsx_bin = runner_dir.join("node_modules/.bin/tsx");
    let (cmd, args): (std::path::PathBuf, Vec<String>) = if tsx_bin.exists() {
        (tsx_bin, vec![script_path.clone()])
    } else {
        // Fallback: try npx tsx
        (std::path::PathBuf::from("npx"), vec!["tsx".to_string(), script_path.clone()])
    };

    let mut child = Command::new(&cmd)
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env_remove("CLAUDECODE")
        .spawn()
        .map_err(|e| format!("Failed to spawn SDK runner: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let config_line = format!("{}\n", sdk_config_json);
        stdin
            .write_all(config_line.as_bytes())
            .map_err(|e| format!("Failed to write to SDK runner stdin: {}", e))?;
        // Drop stdin to signal EOF (non-streaming mode reads first line then closes rl)
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for SDK runner: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("SDK runner produced no output. stderr: {}", stderr));
    }

    // Check if the output contains an error
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
        if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
            return Err(format!("SDK runner error: {}", err));
        }
    }

    Ok(stdout)
}

/// Run SDK runner in streaming mode — reads stdout line-by-line and emits events.
/// Keeps stdin open for interject messages (AsyncGenerator prompt on the TS side).
/// Returns the final result JSON string.
fn run_sdk_runner_stream(sdk_config_json: &str, app_handle: &tauri::AppHandle) -> Result<String, String> {
    let script_path = runner_script_path();
    let runner_dir = std::path::Path::new(&script_path).parent().unwrap_or(std::path::Path::new("."));
    let tsx_bin = runner_dir.join("node_modules/.bin/tsx");
    let (cmd, args): (std::path::PathBuf, Vec<String>) = if tsx_bin.exists() {
        (tsx_bin, vec![script_path.clone()])
    } else {
        (std::path::PathBuf::from("npx"), vec!["tsx".to_string(), script_path.clone()])
    };

    let mut child = Command::new(&cmd)
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env_remove("CLAUDECODE")
        .spawn()
        .map_err(|e| format!("Failed to spawn SDK runner: {}", e))?;

    // Store PID for cancellation
    let pid = child.id();
    if let Ok(mut guard) = AGENT_PID.try_lock() {
        *guard = Some(pid);
    }

    // Write config as first line (newline-terminated for readline)
    let mut stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    {
        let config_line = format!("{}\n", sdk_config_json);
        stdin
            .write_all(config_line.as_bytes())
            .map_err(|e| format!("Failed to write to SDK runner stdin: {}", e))?;
        stdin.flush().map_err(|e| format!("Failed to flush stdin: {}", e))?;
    }

    // Store stdin handle for interject_agent to use
    if let Ok(mut guard) = AGENT_STDIN.lock() {
        *guard = Some(stdin);
    }

    let stdout = child.stdout.take()
        .ok_or("Failed to capture stdout")?;

    let reader = BufReader::new(stdout);
    let mut final_result = String::new();
    let mut was_cancelled = false;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => { was_cancelled = true; break; }
        };
        if line.is_empty() { continue; }

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            match json.get("type").and_then(|t| t.as_str()) {
                Some("delta") => {
                    if let Some(text) = json.get("text").and_then(|t| t.as_str()) {
                        let _ = app_handle.emit("agent-stream-delta", text);
                    }
                }
                Some("status") => {
                    if let Some(status) = json.get("status").and_then(|s| s.as_str()) {
                        let _ = app_handle.emit("agent-stream-status", status);
                    }
                }
                Some("result") => {
                    final_result = line;
                    break; // Got final result, exit read loop
                }
                Some("error") => {
                    if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
                        // Clean up stdin handle
                        if let Ok(mut guard) = AGENT_STDIN.lock() { *guard = None; }
                        return Err(format!("SDK runner error: {}", err));
                    }
                }
                _ => {}
            }
        }
    }

    // Clear PID and stdin handle
    if let Ok(mut guard) = AGENT_PID.try_lock() {
        *guard = None;
    }
    if let Ok(mut guard) = AGENT_STDIN.lock() {
        *guard = None;
    }

    // Wait for process to finish
    let _ = child.wait();

    if was_cancelled {
        return Err("cancelled".to_string());
    }

    if final_result.is_empty() {
        return Err("SDK runner produced no result".to_string());
    }

    // Strip the "type" field from the result for compatibility
    if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&final_result) {
        json.as_object_mut().map(|o| o.remove("type"));
        return Ok(serde_json::to_string(&json).unwrap_or(final_result));
    }

    Ok(final_result)
}

/// Build SDK config JSON from individual parameters.
fn build_sdk_config(
    prompt: &str,
    instructions: &str,
    allowed_tools: &str,
    disallowed_tools: Option<&str>,
    session_id: Option<&str>,
    resume: bool,
    continue_session: Option<bool>,
    agents: Option<&str>,
    enable_checkpointing: bool,
    cwd: Option<&str>,
    max_turns: Option<u32>,
    max_budget_usd: Option<f64>,
    effort: Option<&str>,
    model: Option<&str>,
) -> String {
    let allowed: Vec<&str> = if allowed_tools.is_empty() {
        vec![]
    } else {
        allowed_tools.split(',').collect()
    };

    let disallowed: Vec<&str> = match disallowed_tools {
        Some(d) if !d.is_empty() => d.split(',').collect(),
        _ => vec![],
    };

    let agents_value: serde_json::Value = match agents {
        Some(a) if !a.is_empty() => serde_json::from_str(a).unwrap_or(serde_json::json!({})),
        _ => serde_json::json!({}),
    };

    let mut config = serde_json::json!({
        "prompt": prompt,
        "systemPrompt": instructions,
        "allowedTools": allowed,
        "disallowedTools": disallowed,
        "agents": agents_value,
        "sessionId": session_id,
        "resume": resume,
        "continue": continue_session.unwrap_or(false),
        "model": model.unwrap_or("opus"),
        "permissionMode": "bypassPermissions",
        "enableCheckpointing": enable_checkpointing,
        "cwd": cwd,
    });

    if let Some(turns) = max_turns {
        config["maxTurns"] = serde_json::json!(turns);
    }
    if let Some(budget) = max_budget_usd {
        config["maxBudgetUsd"] = serde_json::json!(budget);
    }
    if let Some(e) = effort {
        config["effort"] = serde_json::json!(e);
    }

    serde_json::to_string(&config).unwrap_or_default()
}

/// Returns JSON: {"session_id": "...", "result": "...", "cost_usd": ..., "num_turns": ...}
#[tauri::command]
async fn run_agent(
    prompt: String,
    instructions: String,
    allowed_tools: String,
    disallowed_tools: Option<String>,
    session_id: Option<String>,
    continue_session: Option<bool>,
    agents: Option<String>,
    enable_checkpointing: Option<bool>,
    cwd: Option<String>,
    max_turns: Option<u32>,
    max_budget_usd: Option<f64>,
    effort: Option<String>,
    model: Option<String>,
) -> Result<String, String> {

    tokio::task::spawn_blocking(move || {
        let config = build_sdk_config(
            &prompt,
            &instructions,
            &allowed_tools,
            disallowed_tools.as_deref(),
            session_id.as_deref(),
            false,
            continue_session,
            agents.as_deref(),
            enable_checkpointing.unwrap_or(true),
            cwd.as_deref(),
            max_turns,
            max_budget_usd,
            effort.as_deref(),
            model.as_deref(),
        );
        run_sdk_runner(&config)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Returns JSON: {"session_id": "...", "result": "...", "cost_usd": ..., "num_turns": ...}
#[tauri::command]
async fn resume_agent(
    prompt: String,
    instructions: String,
    allowed_tools: String,
    disallowed_tools: Option<String>,
    session_id: String,
    continue_session: Option<bool>,
    agents: Option<String>,
    enable_checkpointing: Option<bool>,
    cwd: Option<String>,
    max_turns: Option<u32>,
    max_budget_usd: Option<f64>,
    effort: Option<String>,
    model: Option<String>,
) -> Result<String, String> {

    tokio::task::spawn_blocking(move || {
        let config = build_sdk_config(
            &prompt,
            &instructions,
            &allowed_tools,
            disallowed_tools.as_deref(),
            Some(&session_id),
            true,
            continue_session,
            agents.as_deref(),
            enable_checkpointing.unwrap_or(true),
            cwd.as_deref(),
            max_turns,
            max_budget_usd,
            effort.as_deref(),
            model.as_deref(),
        );
        run_sdk_runner(&config)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Streaming version of run_agent — emits deltas via Tauri events.
/// Returns final JSON: {"session_id": "...", "result": "...", "cost_usd": ..., "num_turns": ...}
#[tauri::command]
async fn run_agent_stream(
    app_handle: tauri::AppHandle,
    prompt: String,
    instructions: String,
    allowed_tools: String,
    disallowed_tools: Option<String>,
    session_id: Option<String>,
    continue_session: Option<bool>,
    agents: Option<String>,
    enable_checkpointing: Option<bool>,
    cwd: Option<String>,
    max_turns: Option<u32>,
    max_budget_usd: Option<f64>,
    effort: Option<String>,
    model: Option<String>,
) -> Result<String, String> {

    let ah = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let mut config = build_sdk_config(
            &prompt,
            &instructions,
            &allowed_tools,
            disallowed_tools.as_deref(),
            session_id.as_deref(),
            false,
            continue_session,
            agents.as_deref(),
            enable_checkpointing.unwrap_or(true),
            cwd.as_deref(),
            max_turns,
            max_budget_usd,
            effort.as_deref(),
            model.as_deref(),
        );
        // Inject stream: true into the config JSON
        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&config) {
            json["stream"] = serde_json::json!(true);
            config = serde_json::to_string(&json).unwrap_or(config);
        }
        run_sdk_runner_stream(&config, &ah)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Streaming version of resume_agent.
#[tauri::command]
async fn resume_agent_stream(
    app_handle: tauri::AppHandle,
    prompt: String,
    instructions: String,
    allowed_tools: String,
    disallowed_tools: Option<String>,
    session_id: String,
    continue_session: Option<bool>,
    agents: Option<String>,
    enable_checkpointing: Option<bool>,
    cwd: Option<String>,
    max_turns: Option<u32>,
    max_budget_usd: Option<f64>,
    effort: Option<String>,
    model: Option<String>,
) -> Result<String, String> {

    let ah = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let mut config = build_sdk_config(
            &prompt,
            &instructions,
            &allowed_tools,
            disallowed_tools.as_deref(),
            Some(&session_id),
            true,
            continue_session,
            agents.as_deref(),
            enable_checkpointing.unwrap_or(true),
            cwd.as_deref(),
            max_turns,
            max_budget_usd,
            effort.as_deref(),
            model.as_deref(),
        );
        if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&config) {
            json["stream"] = serde_json::json!(true);
            config = serde_json::to_string(&json).unwrap_or(config);
        }
        run_sdk_runner_stream(&config, &ah)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Send an interject message to the running agent via stdin.
/// The SDK runner reads this and yields it into the AsyncGenerator prompt.
#[tauri::command]
async fn interject_agent(text: String) -> Result<String, String> {
    let cmd = serde_json::json!({"type": "interject", "text": text});
    let line = format!("{}\n", serde_json::to_string(&cmd).unwrap_or_default());

    if let Ok(mut guard) = AGENT_STDIN.lock() {
        if let Some(ref mut stdin) = *guard {
            stdin.write_all(line.as_bytes())
                .map_err(|e| format!("Failed to write interject: {}", e))?;
            stdin.flush()
                .map_err(|e| format!("Failed to flush interject: {}", e))?;
            return Ok("interjected".to_string());
        }
    }
    Err("No agent stdin available".to_string())
}

/// Cancel the currently running agent — sends stop signal via stdin first,
/// then falls back to SIGTERM if needed.
#[tauri::command]
async fn cancel_agent() -> Result<String, String> {
    // Try graceful stop via stdin first
    let stop_cmd = serde_json::json!({"type": "stop"});
    let stop_line = format!("{}\n", serde_json::to_string(&stop_cmd).unwrap_or_default());
    if let Ok(mut guard) = AGENT_STDIN.lock() {
        if let Some(ref mut stdin) = *guard {
            let _ = stdin.write_all(stop_line.as_bytes());
            let _ = stdin.flush();
        }
        *guard = None; // Drop stdin handle
    }

    let pid = {
        let guard = AGENT_PID.lock().await;
        *guard
    };
    if let Some(pid) = pid {
        // Send SIGTERM as fallback
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        let mut guard = AGENT_PID.lock().await;
        *guard = None;
        Ok("cancelled".to_string())
    } else {
        Ok("no agent running".to_string())
    }
}

/// Save an uploaded file to ~/.flaude/uploads/{timestamp}_{file_name}.
/// file_data_base64 is the file content encoded as a base64 string.
/// Returns the absolute path of the saved file.
#[tauri::command]
async fn save_chat_file(file_name: String, file_data_base64: String) -> Result<String, String> {
    use base64::Engine as _;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&file_data_base64)
        .map_err(|e| format!("base64 decode error: {}", e))?;

    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let uploads_dir = PathBuf::from(&home).join(".flaude").join("uploads");
    std::fs::create_dir_all(&uploads_dir)
        .map_err(|e| format!("failed to create uploads dir: {}", e))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("time error: {}", e))?
        .as_millis();

    let dest = uploads_dir.join(format!("{}_{}", timestamp, file_name));
    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("failed to write file: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

/// Get the data directory path. Uses custom path from ~/.flaude/config.json if set,
/// otherwise defaults to ~/.flaude/data/
fn get_data_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let flaude_dir = std::path::PathBuf::from(&home).join(".flaude");
    let config_path = flaude_dir.join("config.json");

    if config_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(dir) = config.get("data_dir").and_then(|v| v.as_str()) {
                    let custom = std::path::PathBuf::from(dir);
                    std::fs::create_dir_all(&custom)
                        .map_err(|e| format!("failed to create data dir: {}", e))?;
                    return Ok(custom);
                }
            }
        }
    }

    let default_dir = flaude_dir.join("data");
    std::fs::create_dir_all(&default_dir)
        .map_err(|e| format!("failed to create data dir: {}", e))?;
    Ok(default_dir)
}

/// Read a JSON file from the data directory.
#[tauri::command]
async fn read_data(key: String) -> Result<String, String> {
    let dir = get_data_dir()?;
    let path = dir.join(format!("{}.json", key));
    if !path.exists() {
        return Ok("null".to_string());
    }
    std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {}", key, e))
}

/// Write a JSON file to the data directory.
#[tauri::command]
async fn write_data(key: String, value: String) -> Result<(), String> {
    let dir = get_data_dir()?;
    let path = dir.join(format!("{}.json", key));
    std::fs::write(&path, &value)
        .map_err(|e| format!("failed to write {}: {}", key, e))
}

/// Get the current data directory path.
#[tauri::command]
async fn get_data_path() -> Result<String, String> {
    let dir = get_data_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

/// Set a custom data directory path.
#[tauri::command]
async fn set_data_path(path: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let config_path = std::path::PathBuf::from(&home).join(".flaude").join("config.json");
    let flaude_dir = std::path::PathBuf::from(&home).join(".flaude");
    std::fs::create_dir_all(&flaude_dir)
        .map_err(|e| format!("failed to create .flaude dir: {}", e))?;

    // Read existing config or create new
    let mut config: serde_json::Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    config["data_dir"] = serde_json::json!(path);

    // Ensure target directory exists
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("failed to create target dir: {}", e))?;

    std::fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap_or_default())
        .map_err(|e| format!("failed to write config: {}", e))
}

// ── WebSocket client ──────────────────────────────────

/// Connect to flaude.com WebSocket hub and listen for tasks.
/// When a task arrives, execute the agent and send result back.
#[tauri::command]
async fn ws_connect(server_url: String, token: String) -> Result<String, String> {
    use tokio_tungstenite::connect_async;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let ws_url = format!("{}/ws/agent/?token={}", server_url.replace("http", "ws"), token);

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    {
        let mut connected = WS_CONNECTED.lock().await;
        *connected = true;
    }

    // Wrap writer in Arc<Mutex> so spawned tasks can send results back
    let write = std::sync::Arc::new(tokio::sync::Mutex::new(write));

    // Spawn listener task — reads messages and spawns a task per execute request
    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if json.get("type").and_then(|t| t.as_str()) == Some("execute") {
                            let task_id = json.get("task_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let sdk_config = json.get("sdk_config").and_then(|v| v.as_str()).unwrap_or("{}").to_string();
                            let writer = write.clone();

                            // Spawn each task so the read loop isn't blocked
                            tokio::spawn(async move {
                                let result = execute_task_with_sdk(&sdk_config).await;
                                let response = serde_json::json!({
                                    "type": "execution_result",
                                    "task_id": task_id,
                                    "result": result,
                                });
                                if let Ok(msg_str) = serde_json::to_string(&response) {
                                    let mut w = writer.lock().await;
                                    let _ = w.send(Message::Text(msg_str.into())).await;
                                }
                            });
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    break;
                }
                Err(_) => {
                    break;
                }
                _ => {}
            }
        }

        // Mark disconnected
        if let Ok(mut connected) = WS_CONNECTED.try_lock() {
            *connected = false;
        }
    });

    Ok("WebSocket connected".into())
}

/// Execute a task received via WebSocket using SDK runner.
/// sdk_config is the full JSON config string to pass to agent-runner.ts.
async fn execute_task_with_sdk(sdk_config: &str) -> String {
    let config_owned = sdk_config.to_string();

    match tokio::task::spawn_blocking(move || {
        run_sdk_runner(&config_owned)
    }).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => {
            let err = serde_json::json!({"error": e});
            serde_json::to_string(&err).unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", e))
        }
        Err(e) => {
            let err = serde_json::json!({"error": format!("Task error: {}", e)});
            serde_json::to_string(&err).unwrap_or_else(|_| format!("{{\"error\":\"Task error: {}\"}}", e))
        }
    }
}

/// Check WebSocket connection status
#[tauri::command]
async fn ws_status() -> Result<bool, String> {
    let connected = WS_CONNECTED.lock().await;
    Ok(*connected)
}

// ── Integration setup commands ──────────────────────

/// Parse `claude mcp list` output for a server.
fn check_mcp_status(name: &str) -> String {
    match shell("claude mcp list 2>/dev/null") {
        Ok(list) => {
            let lower = name.to_lowercase();
            for line in list.lines() {
                let ll = line.to_lowercase();
                if ll.contains(&lower) {
                    if ll.contains("needs authentication") || ll.contains("! needs") {
                        return "needs_auth".into();
                    } else if ll.contains("failed") || ll.contains("✗") {
                        return "error".into();
                    } else {
                        return "connected".into();
                    }
                }
            }
            "not_installed".into()
        }
        Err(_) => "not_installed".into(),
    }
}

#[tauri::command]
async fn check_integration(id: String) -> Result<String, String> {
    if !KNOWN_INTEGRATIONS.contains(&id.as_str()) {
        return Err(format!("Unknown integration: {}", id));
    }

    match id.as_str() {
        "gws" => {
            match shell("gws --version 2>/dev/null") {
                Ok(v) if !v.is_empty() => {
                    let ver = v.lines().next().unwrap_or(&v);
                    match shell("gws auth status 2>/dev/null") {
                        Ok(s) if s.contains("logged in") || s.contains("authenticated") => {
                            Ok(format!("connected:{}", ver))
                        }
                        _ => Ok(format!("needs_auth:{}", ver)),
                    }
                }
                _ => Ok("not_installed".into()),
            }
        }
        other => Ok(check_mcp_status(other)),
    }
}

#[tauri::command]
async fn auth_integration(id: String) -> Result<String, String> {
    if !KNOWN_INTEGRATIONS.contains(&id.as_str()) {
        return Err(format!("Unknown integration: {}", id));
    }

    match id.as_str() {
        "gws" => {
            shell("gws auth login &")?;
            Ok("Browser opened for Google authentication.".into())
        }
        name => {
            let script = format!(
                r#"osascript -e 'tell application "Terminal"
    activate
    do script "echo \"\\n=== Flaude: {} Authentication ===\\nType /mcp and select {} to authenticate.\\nAfter auth, you can close this window.\\n\" && claude"
end tell'"#,
                name, name
            );
            shell(&script)?;
            Ok(format!("Terminal opened. Type /mcp → select {} → authenticate in browser.", name))
        }
    }
}

#[tauri::command]
async fn setup_integration(id: String, _env_vars: Option<String>) -> Result<String, String> {
    match id.as_str() {
        "gws" => {
            shell("npm install -g @googleworkspace/cli")?;
            shell("gws auth setup 2>/dev/null || true")?;
            Ok("gws CLI installed. Run 'gws auth login' in terminal to complete authentication.".into())
        }
        "github" => {
            shell("claude mcp add --transport http github https://api.githubcopilot.com/mcp/ 2>/dev/null || true")?;
            Ok("GitHub MCP added. Run '/mcp' in Claude Code to authenticate.".into())
        }
        "discord" => {
            Ok("Discord bot is managed by Flaude server. Use 'Add to Server' to invite.".into())
        }
        "slack" => {
            shell("claude mcp add --transport http slack https://slack-mcp.anthropic.com/mcp 2>/dev/null || true")?;
            Ok("Slack MCP added. Run '/mcp' in Claude Code to authenticate.".into())
        }
        "sentry" => {
            shell("claude mcp add --transport http sentry https://mcp.sentry.dev/mcp 2>/dev/null || true")?;
            Ok("Sentry MCP added. Run '/mcp' in Claude Code to authenticate.".into())
        }
        "linear" => {
            shell("claude mcp add --transport http linear https://mcp.linear.app/mcp 2>/dev/null || true")?;
            Ok("Linear MCP added. Run '/mcp' in Claude Code to authenticate.".into())
        }
        "notion" => {
            shell("claude mcp add --transport http notion https://mcp.notion.com/mcp 2>/dev/null || true")?;
            Ok("Notion MCP added. Run '/mcp' in Claude Code to authenticate.".into())
        }
        "figma" => {
            shell("claude mcp add --transport http figma https://mcp.figma.com/mcp 2>/dev/null || true")?;
            Ok("Figma MCP added. Run '/mcp' in Claude Code to authenticate.".into())
        }
        _ => Err(format!("Unknown integration: {}", id)),
    }
}

#[tauri::command]
async fn setup_all_integrations() -> Result<String, String> {
    let mut results = Vec::new();

    match shell("which gws 2>/dev/null") {
        Ok(v) if !v.is_empty() => results.push("GWS: already installed".into()),
        _ => {
            shell("npm install -g @googleworkspace/cli 2>/dev/null")?;
            results.push("GWS: installed".to_string());
        }
    }

    let mcp_servers = vec![
        ("github", "https://api.githubcopilot.com/mcp/"),
        ("slack", "https://slack-mcp.anthropic.com/mcp"),
    ];

    for (name, url) in mcp_servers {
        let status = check_mcp_status(name);
        if status != "not_installed" {
            results.push(format!("{}: already added ({})", name, status));
        } else {
            let cmd = format!(
                "claude mcp add --transport http {} {} 2>/dev/null || true",
                name, url
            );
            shell(&cmd)?;
            results.push(format!("{}: added", name));
        }
    }

    results.push("Discord: Use 'Add to Server' button to invite the bot.".into());
    results.push("Done. Run '/mcp' in Claude Code to authenticate GitHub & Slack.".into());
    Ok(results.join("\n"))
}

// ── Setup wizard checks ─────────────────────────────

#[tauri::command]
async fn check_claude_installed() -> Result<bool, String> {
    match shell("which claude 2>/dev/null") {
        Ok(path) => Ok(!path.is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn check_claude_auth() -> Result<bool, String> {
    match shell("claude --version 2>/dev/null") {
        Ok(v) => Ok(!v.is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn install_claude() -> Result<String, String> {
    shell("npm install -g @anthropic-ai/claude-code")?;
    Ok("Claude Code installed successfully.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            run_agent,
            resume_agent,
            run_agent_stream,
            resume_agent_stream,
            cancel_agent,
            interject_agent,
            check_integration,
            setup_integration,
            setup_all_integrations,
            auth_integration,
            ws_connect,
            ws_status,
            check_claude_installed,
            check_claude_auth,
            install_claude,
            save_chat_file,
            read_data,
            write_data,
            get_data_path,
            set_data_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
