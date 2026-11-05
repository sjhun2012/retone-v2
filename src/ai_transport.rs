//! Shared Responses API transport. Never cache failed/truncated output as PASS.
use serde_json::{json, Value};
use std::{env, time::Duration};

pub fn output_text(value: &Value) -> Option<String> {
    if value.get("error").is_some_and(|e| !e.is_null()) || value["status"] != "completed" { return None; }
    let text = value["output"].as_array()?.iter()
        .filter(|item| item["type"] == "message")
        .flat_map(|item| item["content"].as_array().into_iter().flatten())
        .filter(|part| part["type"] == "output_text")
        .filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join("");
    if text.trim().is_empty() { None } else { Some(text.trim().to_string()) }
}
async fn response(prompt: &str, format: Value, max_tokens: u32) -> Option<String> {
    let key = env::var("OPENAI_API_KEY").ok().filter(|key| !key.trim().is_empty())?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().ok()?;
    let response = match client.post("https://api.openai.com/v1/responses").bearer_auth(key)
        .json(&json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":max_tokens,"store":false,"text":{"format":format}}))
        .send().await {
        Ok(response) => response,
        Err(_) => { eprintln!("AI request failed or timed out"); return None; }
    };
    if !response.status().is_success() {
        // Log status only, never API keys, prompts or conversation content.
        eprintln!("AI upstream HTTP {}", response.status().as_u16()); return None;
    }
    let value = response.json::<Value>().await.ok()?;
    let result = output_text(&value);
    if result.is_none() { eprintln!("AI output missing, refused or incomplete"); }
    result
}
pub async fn text_response(prompt: &str, max_tokens: u32) -> Option<String> {
    response(prompt, json!({"type":"text"}), max_tokens).await
}
pub async fn json_response(prompt: &str, schema: Value, max_tokens: u32) -> Option<Value> {
    let text = response(prompt, json!({"type":"json_schema","name":"retone_result","strict":true,"schema":schema}), max_tokens).await?;
    serde_json::from_str(&text).ok()
}
pub fn check_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["verdict","suggestion","info"],"properties":{
        "verdict":{"type":"string","enum":["PASS","WARN"]},"suggestion":{"type":["string","null"]},
        "info":{"type":"object","additionalProperties":false,"required":["level","note","queries"],"properties":{
            "level":{"type":"string","enum":["none","check"]},"note":{"type":["string","null"]},"queries":{"type":"array","items":{"type":"string"}}
        }}
    }})
}
pub fn schedule_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["is_schedule","title","fields"],"properties":{
        "is_schedule":{"type":"boolean"},"title":{"type":"string"},"fields":{"type":"array","items":{
            "type":"object","additionalProperties":false,"required":["label","value"],"properties":{"label":{"type":"string"},"value":{"type":"string"}}
        }}
    }})
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn reads_messages_after_reasoning() {
        let v=json!({"status":"completed","output":[{"type":"reasoning"},{"type":"message","content":[{"type":"output_text","text":"{\"verdict\":\"WARN\"}"}]}]});
        assert_eq!(output_text(&v).unwrap(), "{\"verdict\":\"WARN\"}");
    }
    #[test] fn rejects_truncation_errors_and_refusals() {
        for v in [json!({"status":"incomplete","output":[{"type":"message","content":[{"type":"output_text","text":"{}"}]}]}),json!({"status":"completed","error":{"code":"invalid_api_key"}}),json!({"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"no"}]}]})] { assert!(output_text(&v).is_none()); }
    }
}
