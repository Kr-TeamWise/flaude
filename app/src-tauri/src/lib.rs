use std::process::Command;
use std::sync::Arc;
use uuid::Uuid;
use tokio::sync::Mutex;
use once_cell::sync::Lazy;

/// Only one agent runs at a time (Claude Code Max concurrency limit).
static AGENT_LOCK: Lazy<Arc<Mutex<()>>> = Lazy::new(|| Arc::new(Mutex::new(())));

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

/// Build common claude CLI args and run.
/// Returns JSON: {"session_id": "...", "result": "..."}
fn build_and_run(
    prompt: &str,
    instructions: &str,
    allowed_tools: &str,
    disallowed_tools: Option<&str>,
    session_id: Option<&str>,
    resume_id: Option<&str>,
    cwd: Option<&str>,
) -> Result<String, String> {
    let sid = match resume_id {
        Some(rid) => rid.to_string(),
        None => session_id.map(|s| s.to_string()).unwrap_or_else(|| Uuid::new_v4().to_string()),
    };

    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--model")
        .arg("opus")
        .arg("--system-prompt")
        .arg(instructions)
        .arg("--permission-mode")
        .arg("bypassPermissions");

    if !allowed_tools.is_empty() {
        cmd.arg("--allowedTools").arg(allowed_tools);
    }
    if let Some(disallowed) = disallowed_tools {
        if !disallowed.is_empty() {
            cmd.arg("--disallowedTools").arg(disallowed);
        }
    }

    if let Some(rid) = resume_id {
        cmd.arg("--resume").arg(rid);
    } else {
        cmd.arg("--session-id").arg(&sid);
    }

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.env_remove("CLAUDECODE");

    let output = cmd.output().map_err(|e| format!("Failed to run claude: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Agent error: {}", stderr));
    }

    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let response = serde_json::json!({
        "session_id": sid,
        "result": result
    });
    serde_json::to_string(&response)
        .map_err(|e| format!("JSON serialization error: {}", e))
}

/// Returns JSON: {"session_id": "...", "result": "..."}
#[tauri::command]
async fn run_agent(
    prompt: String,
    instructions: String,
    allowed_tools: String,
    disallowed_tools: Option<String>,
    session_id: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let _guard = AGENT_LOCK.lock().await;
    tokio::task::spawn_blocking(move || {
        build_and_run(
            &prompt,
            &instructions,
            &allowed_tools,
            disallowed_tools.as_deref(),
            session_id.as_deref(),
            None,
            cwd.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Returns JSON: {"session_id": "...", "result": "..."}
#[tauri::command]
async fn resume_agent(
    prompt: String,
    instructions: String,
    allowed_tools: String,
    disallowed_tools: Option<String>,
    session_id: String,
    cwd: Option<String>,
) -> Result<String, String> {
    let _guard = AGENT_LOCK.lock().await;
    tokio::task::spawn_blocking(move || {
        build_and_run(
            &prompt,
            &instructions,
            &allowed_tools,
            disallowed_tools.as_deref(),
            None,
            Some(&session_id),
            cwd.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
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

    // Spawn listener task
    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if json.get("type").and_then(|t| t.as_str()) == Some("execute") {
                            let task_id = json.get("task_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let agent_name = json.get("agent_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let prompt = json.get("prompt").and_then(|v| v.as_str()).unwrap_or("").to_string();

                            // Execute agent (we need agent details from server)
                            // For now, use agent_name to fetch from server API
                            let result = execute_task_from_ws(&agent_name, &prompt).await;

                            // Send result back
                            let response = serde_json::json!({
                                "type": "execution_result",
                                "task_id": task_id,
                                "result": result,
                            });
                            if let Ok(msg_str) = serde_json::to_string(&response) {
                                let _ = write.send(Message::Text(msg_str.into())).await;
                            }
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

/// Execute a task received via WebSocket
async fn execute_task_from_ws(agent_name: &str, prompt: &str) -> String {
    let instructions = format!("You are {}. Follow the user's instructions carefully.", agent_name);
    let _guard = AGENT_LOCK.lock().await;

    let prompt_owned = prompt.to_string();
    let instructions_owned = instructions;

    match tokio::task::spawn_blocking(move || {
        build_and_run(&prompt_owned, &instructions_owned, "", None, None, None, None)
    }).await {
        Ok(Ok(result)) => {
            // Extract just the result text from JSON
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&result) {
                json.get("result").and_then(|r| r.as_str()).unwrap_or(&result).to_string()
            } else {
                result
            }
        }
        Ok(Err(e)) => format!("Error: {}", e),
        Err(e) => format!("Task error: {}", e),
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
        .invoke_handler(tauri::generate_handler![
            run_agent,
            resume_agent,
            check_integration,
            setup_integration,
            setup_all_integrations,
            auth_integration,
            ws_connect,
            ws_status,
            check_claude_installed,
            check_claude_auth,
            install_claude,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
