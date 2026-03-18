use std::io::{Write as IoWrite, BufRead, BufReader};
use std::process::{Command, ChildStdin};
use std::sync::Arc;
use tokio::sync::Mutex;
use once_cell::sync::Lazy;
use tauri::Emitter;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// PID of the currently running agent subprocess (for cancellation).
static AGENT_PID: Lazy<Arc<Mutex<Option<u32>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Stdin handle for the running agent subprocess (for interject messages).
static AGENT_STDIN: Lazy<Arc<std::sync::Mutex<Option<ChildStdin>>>> = Lazy::new(|| Arc::new(std::sync::Mutex::new(None)));

/// WebSocket connection state
static WS_CONNECTED: Lazy<Arc<Mutex<bool>>> = Lazy::new(|| Arc::new(Mutex::new(false)));

/// Recording state
static RECORDING_PID: Lazy<Arc<Mutex<Option<u32>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));
static RECORDING_START: Lazy<Arc<Mutex<Option<std::time::Instant>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));
static RECORDING_PATH: Lazy<Arc<Mutex<Option<String>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Allowlist of known integration IDs to prevent injection.
const KNOWN_INTEGRATIONS: &[&str] = &[
    "gws", "github", "discord", "slack", "sentry", "linear", "notion", "figma",
];

/// Run a shell command and return stdout (cross-platform)
fn shell(script: &str) -> Result<String, String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", script])
            .output()
    } else {
        Command::new("zsh")
            .arg("-l")
            .arg("-c")
            .arg(script)
            .output()
    }.map_err(|e| format!("shell error: {}", e))?;
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

/// Open a URL in the default browser (cross-platform)
fn open_url(url: &str) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).spawn()
    } else {
        Command::new("open").arg(url).spawn()
    }.map_err(|e| format!("open_url error: {}", e))?;
    Ok(())
}

/// Spawn a background shell command (cross-platform, non-blocking)
fn shell_spawn(script: &str) -> Result<std::process::Child, String> {
    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", script])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
    } else {
        Command::new("zsh")
            .arg("-l")
            .arg("-c")
            .arg(script)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
    }.map_err(|e| format!("shell_spawn error: {}", e))
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

/// Connect to flaude.team WebSocket hub and listen for tasks.
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
                        Ok(s) if s.contains("token_valid") && s.contains("true") => {
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
            // Spawn gws auth login, redirect output to temp file, poll for URL
            std::thread::spawn(|| {
                let tmpfile = if cfg!(target_os = "windows") {
                    std::env::temp_dir().join("flaude_gws_auth.log")
                } else {
                    std::path::PathBuf::from("/tmp/flaude_gws_auth.log")
                };
                let _ = std::fs::remove_file(&tmpfile);
                let cmd = format!(
                    "gws auth login -s drive,spreadsheets,gmail,calendar,documents,presentations,tasks,pubsub,cloud-platform > \"{}\" 2>&1",
                    tmpfile.display()
                );
                let _ = shell_spawn(&cmd);
                // Poll the file for the Google OAuth URL
                for _ in 0..30 {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    if let Ok(content) = std::fs::read_to_string(&tmpfile) {
                        if let Some(start) = content.find("https://accounts.google.com") {
                            if let Some(end) = content[start..].find(|c: char| c.is_whitespace()) {
                                let url = &content[start..start + end];
                                let _ = open_url(url);
                                break;
                            }
                        }
                    }
                }
            });
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
            shell("npm install -g @googleworkspace/cli 2>&1")?;
            Ok("gws CLI installed.".into())
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
    if cfg!(target_os = "windows") {
        match shell("where claude 2>nul") {
            Ok(path) => Ok(!path.is_empty()),
            Err(_) => Ok(false),
        }
    } else {
        match shell("test -x /Applications/cmux.app/Contents/Resources/bin/claude && echo found || which claude 2>/dev/null || test -x /usr/local/bin/claude && echo found || test -x \"$HOME/.claude/local/claude\" && echo found || test -x \"$HOME/.nvm/versions/node/*/bin/claude\" && echo found") {
            Ok(path) => Ok(!path.is_empty()),
            Err(_) => Ok(false),
        }
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

#[tauri::command]
async fn login_claude() -> Result<String, String> {
    // claude auth login opens browser automatically
    let _ = shell_spawn("claude auth login");
    Ok("Browser opened for Claude login.".into())
}

#[tauri::command]
async fn shell_command(script: String) -> Result<String, String> {
    shell(&script)
}

// ── Meeting: Dependency checks ──────────────────────

#[tauri::command]
async fn check_whisper_installed() -> Result<bool, String> {
    match shell("which whisper-cli 2>/dev/null || which whisper-cpp 2>/dev/null || which whisper 2>/dev/null") {
        Ok(path) => Ok(!path.is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn check_ffmpeg_installed() -> Result<bool, String> {
    match shell("which ffmpeg 2>/dev/null") {
        Ok(path) => Ok(!path.is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn check_system_audio_supported() -> Result<bool, String> {
    // ScreenCaptureKit on macOS 13+, WASAPI on Windows — always available
    #[cfg(target_os = "macos")]
    { Ok(true) }
    #[cfg(target_os = "windows")]
    { Ok(true) }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { Ok(false) }
}

#[tauri::command]
async fn install_whisper() -> Result<String, String> {
    shell("brew install whisper-cpp")
}

#[tauri::command]
async fn install_ffmpeg() -> Result<String, String> {
    shell("brew install ffmpeg")
}

// BlackHole removed — using ScreenCaptureKit (macOS) / WASAPI (Windows) for system audio

// ── Meeting: Whisper models ─────────────────────────

fn whisper_model_dir() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = format!("{}/.flaude/whisper-models", home);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {}", e))?;
    Ok(dir)
}

#[tauri::command]
async fn list_whisper_models() -> Result<String, String> {
    let known = vec![
        ("base", 140),
        ("small", 490),
        ("medium", 1500),
        ("large", 2900),
    ];

    let model_dir = whisper_model_dir()?;

    let mut models = Vec::new();
    for (name, size_mb) in &known {
        let filename = format!("ggml-{}.bin", name);
        let path = format!("{}/{}", model_dir, filename);
        let downloaded = std::path::Path::new(&path).exists();
        models.push(serde_json::json!({
            "name": name,
            "size_mb": size_mb,
            "path": if downloaded { path } else { "".to_string() },
            "downloaded": downloaded,
        }));
    }

    serde_json::to_string(&models).map_err(|e| format!("JSON error: {}", e))
}

#[tauri::command]
async fn download_whisper_model(name: String) -> Result<String, String> {
    if !["base", "small", "medium", "large"].contains(&name.as_str()) {
        return Err(format!("Unknown model: {}", name));
    }
    let model_dir = whisper_model_dir()?;
    let dest = format!("{}/ggml-{}.bin", model_dir, name);
    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        name
    );

    // Use spawn_blocking + Command directly (shell() has 2min timeout, too short for large models)
    let dest_c = dest.clone();
    tokio::task::spawn_blocking(move || {
        let curl_path = shell("which curl").unwrap_or_else(|_| "/usr/bin/curl".to_string());
        let output = Command::new(&curl_path)
            .args(&["-L", "-o", &dest_c, &url])
            .output()
            .map_err(|e| format!("curl failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("Download failed: {}", stderr));
        }

        // Verify file exists and has reasonable size
        let meta = std::fs::metadata(&dest_c).map_err(|e| format!("File check failed: {}", e))?;
        if meta.len() < 1_000_000 {
            let _ = std::fs::remove_file(&dest_c);
            return Err("Download incomplete — file too small".to_string());
        }

        Ok(dest_c)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn delete_whisper_model(name: String) -> Result<String, String> {
    if !["base", "small", "medium", "large"].contains(&name.as_str()) {
        return Err(format!("Unknown model: {}", name));
    }
    let model_dir = whisper_model_dir()?;
    let path = format!("{}/ggml-{}.bin", model_dir, name);
    if std::path::Path::new(&path).exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Delete failed: {}", e))?;
        Ok(format!("Deleted {}", path))
    } else {
        Err("Model file not found".to_string())
    }
}

// ── Meeting: Transcription ──────────────────────────

#[tauri::command]
async fn transcribe_audio(path: String, model: String, language: String) -> Result<String, String> {
    let path_c = path.clone();
    let model_c = model.clone();
    let lang_c = language.clone();

    tokio::task::spawn_blocking(move || {
        // Resolve model path — fallback to any available model if requested one doesn't exist
        let home = std::env::var("HOME").unwrap_or_default();
        let model_dir = format!("{}/.flaude/whisper-models", home);
        let mut model_path = if std::path::Path::new(&model_c).exists() {
            model_c.clone()
        } else {
            format!("{}/ggml-{}.bin", model_dir, model_c)
        };

        if !std::path::Path::new(&model_path).exists() {
            let fallbacks = ["medium", "small", "base", "large"];
            model_path = String::new();
            for fb in &fallbacks {
                let p = format!("{}/ggml-{}.bin", model_dir, fb);
                if std::path::Path::new(&p).exists() {
                    model_path = p;
                    break;
                }
            }
            if model_path.is_empty() {
                return Err("No whisper model found. Please download a model in Settings > Meeting.".to_string());
            }
        }

        // Convert non-wav files to wav first (whisper-cli needs wav for reliable results)
        let wav_path = if !path_c.ends_with(".wav") {
            let converted = format!("{}.converted.wav", path_c);
            if !std::path::Path::new(&converted).exists() {
                let ffmpeg_path = shell("which ffmpeg").unwrap_or_else(|_| "/opt/homebrew/bin/ffmpeg".to_string());
                let status = Command::new(&ffmpeg_path)
                    .args(&["-i", &path_c, "-ar", "16000", "-ac", "1", "-y", &converted])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .map_err(|e| format!("ffmpeg conversion failed: {}", e))?;
                if !status.success() {
                    return Err("Failed to convert audio file to WAV".to_string());
                }
            }
            converted
        } else {
            path_c.clone()
        };

        let bin = if shell("which whisper-cli 2>/dev/null").is_ok() {
            "whisper-cli"
        } else {
            "whisper-cpp"
        };

        // -oj writes JSON to file. Use -of to specify output path (no extension)
        let json_out = format!("{}.whisper", wav_path);
        let prompt_hint = if lang_c == "ko" { " --prompt '회의 녹취록입니다.'" } else { "" };
        let script = format!(
            "{} -m '{}' -l {} -bs 8 -bo 5{} -oj -of '{}' -f '{}'",
            bin, model_path, lang_c, prompt_hint, json_out, wav_path
        );
        shell(&script)?;

        let json_path = format!("{}.json", json_out);
        std::fs::read_to_string(&json_path)
            .map_err(|e| format!("Failed to read whisper output: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ── Meeting: Subtitle parsing ───────────────────────

fn parse_timestamp_vtt(ts: &str) -> f64 {
    let parts: Vec<&str> = ts.split(':').collect();
    match parts.len() {
        3 => {
            let h: f64 = parts[0].parse().unwrap_or(0.0);
            let m: f64 = parts[1].parse().unwrap_or(0.0);
            let s: f64 = parts[2].replace(',', ".").parse().unwrap_or(0.0);
            h * 3600.0 + m * 60.0 + s
        }
        2 => {
            let m: f64 = parts[0].parse().unwrap_or(0.0);
            let s: f64 = parts[1].replace(',', ".").parse().unwrap_or(0.0);
            m * 60.0 + s
        }
        _ => 0.0,
    }
}

#[tauri::command]
async fn parse_subtitle(path: String) -> Result<String, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let mut segments: Vec<serde_json::Value> = Vec::new();
    let mut full_text = String::new();

    let is_vtt = path.ends_with(".vtt");

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    // Skip VTT header
    if is_vtt {
        while i < lines.len() && !lines[i].contains("-->") {
            i += 1;
        }
    }

    while i < lines.len() {
        let line = lines[i].trim();

        // Skip SRT sequence numbers
        if !is_vtt && line.parse::<u32>().is_ok() {
            i += 1;
            continue;
        }

        if line.contains("-->") {
            let parts: Vec<&str> = line.split("-->").collect();
            if parts.len() == 2 {
                let start = parse_timestamp_vtt(parts[0].trim());
                let end = parse_timestamp_vtt(parts[1].trim().split_whitespace().next().unwrap_or(""));

                // Collect text lines until empty line
                let mut text_lines = Vec::new();
                i += 1;
                while i < lines.len() && !lines[i].trim().is_empty() {
                    text_lines.push(lines[i].trim());
                    i += 1;
                }
                let text = text_lines.join(" ");
                if !text.is_empty() {
                    if !full_text.is_empty() { full_text.push(' '); }
                    full_text.push_str(&text);
                    segments.push(serde_json::json!({
                        "start": start,
                        "end": end,
                        "text": text,
                    }));
                }
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    let result = serde_json::json!({
        "full_text": full_text,
        "segments": segments,
    });
    serde_json::to_string(&result).map_err(|e| format!("JSON error: {}", e))
}

// ── Meeting: Recording ──────────────────────────────
// Mic: ffmpeg (cross-platform)
// System audio: ScreenCaptureKit (macOS) / WASAPI loopback (Windows)
// No BlackHole or virtual audio device needed.

/// Flag to signal system audio recording thread to stop.
static SYSTEM_RECORDING: Lazy<Arc<std::sync::atomic::AtomicBool>> =
    Lazy::new(|| Arc::new(std::sync::atomic::AtomicBool::new(false)));

/// Start recording from mic (ffmpeg) or system audio (native API).
#[tauri::command]
async fn start_recording(source: String, path: String) -> Result<String, String> {
    // Create parent directory
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    if source == "system" {
        // System audio via ScreenCaptureKit (macOS) or WASAPI (Windows)
        start_system_audio_recording(&path).await?;
    } else {
        // Microphone via ffmpeg
        start_mic_recording(&path).await?;
    }

    // Store recording state
    {
        let mut guard = RECORDING_START.lock().await;
        *guard = Some(std::time::Instant::now());
    }
    {
        let mut guard = RECORDING_PATH.lock().await;
        *guard = Some(path.clone());
    }

    let result = serde_json::json!({"path": path, "source": source});
    serde_json::to_string(&result).map_err(|e| format!("JSON error: {}", e))
}

/// Start mic recording via ffmpeg.
async fn start_mic_recording(path: &str) -> Result<(), String> {
    let ffmpeg_path = shell("which ffmpeg")
        .unwrap_or_else(|_| "/opt/homebrew/bin/ffmpeg".to_string());

    #[cfg(target_os = "macos")]
    let args = vec!["-f", "avfoundation", "-i", ":default", "-ar", "16000", "-ac", "1", "-y"];
    #[cfg(target_os = "windows")]
    let args = vec!["-f", "dshow", "-i", "audio=default", "-ar", "16000", "-ac", "1", "-y"];
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let args = vec!["-f", "pulse", "-i", "default", "-ar", "16000", "-ac", "1", "-y"];

    let mut full_args = args.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    full_args.push(path.to_string());

    let mut child = Command::new(&ffmpeg_path)
        .args(&full_args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    let pid = child.id();

    // Wait and check if ffmpeg is still alive
    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
    match child.try_wait() {
        Ok(Some(status)) => {
            return Err(format!(
                "Microphone access failed (code: {}). Grant microphone permission in System Settings > Privacy > Microphone.",
                status
            ));
        }
        Ok(None) => {}
        Err(e) => return Err(format!("Failed to check process: {}", e)),
    }
    std::mem::forget(child);

    let mut guard = RECORDING_PID.lock().await;
    *guard = Some(pid);
    let _ = std::fs::write("/tmp/flaude_recording.pid", pid.to_string());
    Ok(())
}

/// Start system audio recording via ScreenCaptureKit (macOS).
#[cfg(target_os = "macos")]
async fn start_system_audio_recording(path: &str) -> Result<(), String> {
    use screencapturekit::prelude::*;
    use std::sync::atomic::Ordering;

    let path_owned = path.to_string();
    SYSTEM_RECORDING.store(true, Ordering::SeqCst);

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content (grant Screen Recording permission): {:?}", e))?;
        let display = content.displays().into_iter().next()
            .ok_or("No display found")?;

        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build();

        let config = SCStreamConfiguration::new()
            .with_captures_audio(true)
            .with_sample_rate(16000)
            .with_channel_count(1)
            .with_width(2)
            .with_height(2); // Minimal video size (we only want audio)

        // WAV writer
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let writer = std::sync::Arc::new(std::sync::Mutex::new(
            hound::WavWriter::create(&path_owned, spec)
                .map_err(|e| format!("Failed to create WAV: {}", e))?
        ));

        let flag = SYSTEM_RECORDING.clone();
        let writer_clone = writer.clone();

        // Use closure-based handler
        let mut stream = SCStream::new(&filter, &config);
        let flag_c = flag.clone();
        let writer_c = writer_clone.clone();
        stream.add_output_handler(
            move |sample: CMSampleBuffer, of_type: SCStreamOutputType| {
                if !flag_c.load(Ordering::Relaxed) { return; }
                if let SCStreamOutputType::Audio = of_type {
                    if let Some(buf_list) = sample.audio_buffer_list() {
                        if let Ok(mut w) = writer_c.lock() {
                            for buf in buf_list.iter() {
                                let bytes = buf.data();
                                // Audio data is float32 PCM
                                let float_samples: &[f32] = unsafe {
                                    std::slice::from_raw_parts(
                                        bytes.as_ptr() as *const f32,
                                        bytes.len() / 4,
                                    )
                                };
                                for &s in float_samples {
                                    let _ = w.write_sample(s);
                                }
                            }
                        }
                    }
                }
            },
            SCStreamOutputType::Audio,
        );

        stream.start_capture().map_err(|e| format!("Failed to start capture: {:?}", e))?;

        // Block until stop signal
        while flag.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        stream.stop_capture().map_err(|e| format!("Failed to stop capture: {:?}", e))?;

        // Finalize WAV
        drop(stream);
        if let Ok(w) = std::sync::Arc::try_unwrap(writer) {
            if let Ok(w) = w.into_inner() {
                let _ = w.finalize();
            }
        }

        Ok(())
    });

    // Give ScreenCaptureKit a moment to start
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    Ok(())
}

/// Start system audio recording via WASAPI loopback (Windows).
#[cfg(target_os = "windows")]
async fn start_system_audio_recording(path: &str) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::atomic::Ordering;

    let path_owned = path.to_string();
    SYSTEM_RECORDING.store(true, Ordering::SeqCst);

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let host = cpal::default_host();

        // Get default output device and create loopback stream
        let device = host.default_output_device()
            .ok_or("No output device found")?;

        let config = device.default_output_config()
            .map_err(|e| format!("Config error: {}", e))?;

        let spec = hound::WavSpec {
            channels: config.channels(),
            sample_rate: config.sample_rate().0,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };

        let writer = std::sync::Arc::new(std::sync::Mutex::new(
            hound::WavWriter::create(&path_owned, spec)
                .map_err(|e| format!("WAV create error: {}", e))?
        ));

        let writer_c = writer.clone();
        let flag = SYSTEM_RECORDING.clone();

        let stream = device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !flag.load(Ordering::Relaxed) { return; }
                if let Ok(mut w) = writer_c.lock() {
                    for &sample in data { let _ = w.write_sample(sample); }
                }
            },
            |e| eprintln!("Stream error: {}", e),
            None,
        ).map_err(|e| format!("Stream error: {}", e))?;

        stream.play().map_err(|e| format!("Play error: {}", e))?;

        let flag2 = SYSTEM_RECORDING.clone();
        while flag2.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        drop(stream);
        if let Ok(w) = std::sync::Arc::try_unwrap(writer) {
            if let Ok(w) = w.into_inner() { let _ = w.finalize(); }
        }
        Ok(())
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn start_system_audio_recording(_path: &str) -> Result<(), String> {
    Err("System audio capture is not supported on this platform. Use microphone instead.".to_string())
}

#[tauri::command]
async fn stop_recording() -> Result<String, String> {
    // Stop system audio recording if active
    SYSTEM_RECORDING.store(false, std::sync::atomic::Ordering::SeqCst);

    // Stop ffmpeg mic recording if active
    let pid = {
        let mut guard = RECORDING_PID.lock().await;
        guard.take()
    };
    if let Some(pid) = pid {
        unsafe { libc::kill(pid as i32, libc::SIGINT); }
        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
        let _ = std::fs::remove_file("/tmp/flaude_recording.pid");
    }

    // Wait a moment for system audio thread to finish WAV
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    let elapsed = {
        let mut guard = RECORDING_START.lock().await;
        let e = guard.map(|s| s.elapsed().as_secs()).unwrap_or(0);
        *guard = None;
        e
    };

    let path = {
        let mut guard = RECORDING_PATH.lock().await;
        let p = guard.clone().unwrap_or_default();
        *guard = None;
        p
    };

    let result = serde_json::json!({"path": path, "duration_seconds": elapsed});
    serde_json::to_string(&result).map_err(|e| format!("JSON error: {}", e))
}

#[tauri::command]
async fn get_recording_status() -> Result<String, String> {
    let mic_recording = {
        let guard = RECORDING_PID.lock().await;
        guard.is_some()
    };
    let sys_recording = SYSTEM_RECORDING.load(std::sync::atomic::Ordering::Relaxed);
    let recording = mic_recording || sys_recording;

    let elapsed = {
        let guard = RECORDING_START.lock().await;
        guard.map(|s| s.elapsed().as_secs()).unwrap_or(0)
    };
    let path = {
        let guard = RECORDING_PATH.lock().await;
        guard.clone().unwrap_or_default()
    };

    let result = serde_json::json!({
        "recording": recording,
        "path": path,
        "elapsed_seconds": elapsed,
    });
    serde_json::to_string(&result).map_err(|e| format!("JSON error: {}", e))
}

#[tauri::command]
async fn recover_orphan_recording() -> Result<String, String> {
    // Reset system recording flag
    SYSTEM_RECORDING.store(false, std::sync::atomic::Ordering::SeqCst);

    let pid_path = std::path::Path::new("/tmp/flaude_recording.pid");
    if !pid_path.exists() {
        return Ok(serde_json::json!({"orphan": false}).to_string());
    }

    let pid_str = std::fs::read_to_string(pid_path)
        .map_err(|e| format!("Failed to read PID file: {}", e))?;
    let pid: i32 = pid_str.trim().parse()
        .map_err(|e| format!("Invalid PID: {}", e))?;

    let alive = unsafe { libc::kill(pid, 0) == 0 };
    if alive {
        Ok(serde_json::json!({"orphan": true, "pid": pid}).to_string())
    } else {
        let _ = std::fs::remove_file(pid_path);
        Ok(serde_json::json!({"orphan": false, "stale_pid": true}).to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri_plugin_global_shortcut::ShortcutState;

            // Auto-provision GWS client_secret.json if missing
            {
                use tauri::Manager;
                let home = std::env::var("HOME").unwrap_or_default();
                let gws_dir = std::path::PathBuf::from(&home).join(".config/gws");
                let gws_secret = gws_dir.join("client_secret.json");
                if !gws_secret.exists() {
                    if let Ok(resource_dir) = app.path().resource_dir() {
                        let bundled = resource_dir.join("resources/gws_client_secret.json");
                        if bundled.exists() {
                            let _ = std::fs::create_dir_all(&gws_dir);
                            let _ = std::fs::copy(&bundled, &gws_secret);
                        }
                    }
                }
            }

            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+R", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = handle.emit("toggle-recording", ());
                }
            })?;
            // Check for orphan recordings on startup
            let _ = app.handle().emit("check-orphan-recording", ());
            Ok(())
        })
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
            login_claude,
            shell_command,
            save_chat_file,
            read_data,
            write_data,
            get_data_path,
            set_data_path,
            // Meeting commands
            check_whisper_installed,
            check_ffmpeg_installed,
            check_system_audio_supported,
            install_whisper,
            install_ffmpeg,
            list_whisper_models,
            download_whisper_model,
            delete_whisper_model,
            transcribe_audio,
            parse_subtitle,
            start_recording,
            stop_recording,
            get_recording_status,
            recover_orphan_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
