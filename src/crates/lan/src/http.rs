use super::*;
use std::collections::BTreeMap;
#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}
#[derive(Debug)]
pub enum Parse {
    Incomplete,
    Invalid,
    Request(Request),
}
impl Request {
    pub fn parse(bytes: &[u8]) -> Parse {
        if bytes.len() > 65536 {
            return Parse::Invalid;
        }
        let Some(boundary) = bytes.windows(4).position(|s| s == b"\r\n\r\n") else {
            return Parse::Incomplete;
        };
        let Ok(head) = std::str::from_utf8(&bytes[..boundary]) else {
            return Parse::Invalid;
        };
        let mut lines = head.split("\r\n");
        let first = lines
            .next()
            .unwrap_or("")
            .split_ascii_whitespace()
            .collect::<Vec<_>>();
        if first.len() != 3
            || first[2] != "HTTP/1.1"
            || !first[1].starts_with('/')
            || first[1].starts_with("//")
            || first[1].contains('#')
        {
            return Parse::Invalid;
        }
        let (path, query) = first[1]
            .split_once('?')
            .map(|(p, q)| (p, Some(q)))
            .unwrap_or((first[1], None));
        if path.contains('%') {
            return Parse::Invalid;
        }
        if query.is_some_and(|query| {
            path != "/v1/changes" || !query.starts_with("since=") || query.contains('&')
        }) {
            return Parse::Invalid;
        }
        let mut headers = BTreeMap::new();
        for line in lines {
            let Some((key, value)) = line.split_once(':') else {
                return Parse::Invalid;
            };
            let key = key.to_ascii_lowercase();
            if key.is_empty()
                || key.bytes().any(|b| !b.is_ascii_alphanumeric() && b != b'-')
                || headers.insert(key, value.trim().into()).is_some()
            {
                return Parse::Invalid;
            }
        }
        if headers.contains_key("transfer-encoding") {
            return Parse::Invalid;
        }
        let length = match headers
            .get("content-length")
            .map(|v: &String| v.parse::<usize>())
        {
            None => 0,
            Some(Ok(size)) if size <= 8192 => size,
            _ => return Parse::Invalid,
        };
        let body = &bytes[boundary + 4..];
        if body.len() < length {
            return Parse::Incomplete;
        }
        if body.len() != length {
            return Parse::Invalid;
        }
        Parse::Request(Self {
            method: first[0].into(),
            path: path.into(),
            query: query.map(str::to_owned),
            headers,
            body: body.into(),
        })
    }
    pub fn bearer(&self) -> Option<&str> {
        self.headers
            .get("authorization")?
            .strip_prefix("Bearer ")
            .filter(|token| credentials::valid_token(token))
    }
    pub fn cursor(&self) -> Option<crate::Cursor> {
        self.query
            .as_deref()?
            .strip_prefix("since=")
            .and_then(decode_query)
            .and_then(|value| crate::Cursor::parse(&value))
    }
}
pub fn response(status: u16, headers: &[(&str, String)], body: &[u8]) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        410 => "Gone",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let mut fields = BTreeMap::from([
        ("Content-Length", body.len().to_string()),
        ("Connection", "close".into()),
        ("Cache-Control", "no-store".into()),
    ]);
    for (key, value) in headers {
        fields.insert(key, value.clone());
    }
    let mut output = format!("HTTP/1.1 {status} {reason}\r\n");
    for (key, value) in fields {
        output.push_str(&format!("{key}: {value}\r\n"));
    }
    output.push_str("\r\n");
    let mut bytes = output.into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

fn decode_query(value: &str) -> Option<String> {
    let mut out = Vec::new();
    let bytes = value.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            if at + 2 >= bytes.len() {
                return None;
            }
            let code = std::str::from_utf8(&bytes[at + 1..at + 3]).ok()?;
            out.push(u8::from_str_radix(code, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}
