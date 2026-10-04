//! Inspects MCP Streamable HTTP request bodies (JSON-RPC 2.0 over POST, KB-X402-05) to find
//! which tools a request calls. Only `tools/call` is priced; discovery stays free.

use serde_json::Value;

/// What a single MCP POST body asks for.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct McpInspection {
    /// One entry per `tools/call` in the body (batches can hold several). `None` when the
    /// call has no string `params.name`; it is priced at the default tool price.
    pub tool_calls: Vec<Option<String>>,
    /// Every other method in the body (`initialize`, `tools/list`, ...). Always free.
    pub other_methods: Vec<String>,
}

impl McpInspection {
    pub fn is_free(&self) -> bool {
        self.tool_calls.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum McpError {
    #[error("MCP body is not valid JSON")]
    NotJson,
    #[error("MCP body is not a JSON-RPC object or a non-empty batch of objects")]
    NotJsonRpc,
}

/// Parses an MCP POST body. A malformed body is an error rather than "free": the gateway
/// answers 400 instead of forwarding something an origin might parse more leniently.
pub fn inspect(body: &[u8]) -> Result<McpInspection, McpError> {
    let value: Value = serde_json::from_slice(body).map_err(|_| McpError::NotJson)?;
    let messages = match value {
        Value::Array(items) if !items.is_empty() => items,
        Value::Object(_) => vec![value],
        _ => return Err(McpError::NotJsonRpc),
    };

    let mut out = McpInspection::default();
    for message in &messages {
        let Value::Object(obj) = message else {
            return Err(McpError::NotJsonRpc);
        };
        match obj.get("method") {
            Some(Value::String(m)) if m == "tools/call" => {
                let name = obj
                    .get("params")
                    .and_then(|p| p.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                out.tool_calls.push(name);
            }
            Some(Value::String(m)) => out.other_methods.push(m.clone()),
            // A JSON-RPC response from client to server (answers to sampling or elicitation).
            None if obj.contains_key("result") || obj.contains_key("error") => {}
            _ => return Err(McpError::NotJsonRpc),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str) -> String {
        format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"{name}","arguments":{{}}}}}}"#
        )
    }

    #[test]
    fn single_tool_call() {
        let i = inspect(call("search_docs").as_bytes()).unwrap();
        assert_eq!(i.tool_calls, vec![Some("search_docs".into())]);
        assert!(!i.is_free());
    }

    #[test]
    fn discovery_is_free() {
        for method in [
            "initialize",
            "tools/list",
            "notifications/initialized",
            "ping",
            "resources/list",
        ] {
            let body = format!(r#"{{"jsonrpc":"2.0","id":1,"method":"{method}"}}"#);
            let i = inspect(body.as_bytes()).unwrap();
            assert!(i.is_free(), "{method}");
            assert_eq!(i.other_methods, vec![method.to_string()]);
        }
    }

    #[test]
    fn batch_collects_every_call() {
        let body = format!(
            r#"[{},{{"jsonrpc":"2.0","method":"ping","id":2}},{}]"#,
            call("a"),
            call("b")
        );
        let i = inspect(body.as_bytes()).unwrap();
        assert_eq!(i.tool_calls, vec![Some("a".into()), Some("b".into())]);
        assert_eq!(i.other_methods, vec!["ping".to_string()]);
    }

    #[test]
    fn call_without_name_is_still_a_call() {
        let i = inspect(br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":7}}"#)
            .unwrap();
        assert_eq!(i.tool_calls, vec![None]);
    }

    #[test]
    fn client_responses_are_free() {
        let i = inspect(br#"{"jsonrpc":"2.0","id":9,"result":{}}"#).unwrap();
        assert!(i.is_free());
    }

    #[test]
    fn malformed_bodies_are_rejected() {
        assert_eq!(inspect(b"not json"), Err(McpError::NotJson));
        assert_eq!(inspect(b""), Err(McpError::NotJson));
        for bad in [
            &b"[]"[..],
            b"42",
            b"\"x\"",
            b"[1]",
            br#"{"jsonrpc":"2.0","id":1}"#,
            br#"{"method":5}"#,
        ] {
            assert_eq!(
                inspect(bad),
                Err(McpError::NotJsonRpc),
                "{}",
                String::from_utf8_lossy(bad)
            );
        }
    }
}
