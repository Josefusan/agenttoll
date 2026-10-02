//! Canonical request paths for pricing and detection. Origins often decode `%XX`, collapse
//! `//`, resolve `..` and ignore a trailing `/`; if the pricer did not do the same, an agent
//! could request `/api/%71uote` and fall through a priced route into a free catch-all.

/// Returns the canonical form of a request path (query string must already be removed):
/// percent-decoded, duplicate slashes collapsed, `.`/`..` resolved, no trailing slash.
pub fn normalize(raw: &str) -> String {
    let decoded = percent_decode(raw);
    let mut segments: Vec<&str> = Vec::new();
    for seg in decoded.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            s => segments.push(s),
        }
    }
    format!("/{}", segments.join("/"))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push(h << 4 | l);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn canonicalizes() {
        let cases = [
            ("/", "/"),
            ("", "/"),
            ("/api/quote", "/api/quote"),
            ("/api/quote/", "/api/quote"),
            ("//api///quote", "/api/quote"),
            ("/api/%71uote", "/api/quote"),
            ("/api/%2e%2e/blog/x", "/blog/x"),
            ("/blog/../api/./quote", "/api/quote"),
            ("/../../etc", "/etc"),
            ("/a%2Fb", "/a/b"),
            ("/bad%zzpct", "/bad%zzpct"),
            ("/trailing%", "/trailing%"),
            ("/trailing%4", "/trailing%4"),
            ("/caf%C3%A9", "/café"),
        ];
        for (input, want) in cases {
            assert_eq!(normalize(input), want, "{input:?}");
        }
    }
}
