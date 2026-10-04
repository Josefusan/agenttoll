//! Canonical request paths for pricing and detection. Origins often decode `%XX`, collapse
//! `//`, resolve `..` and ignore a trailing `/`; if the pricer did not do the same, an agent
//! could request `/api/%71uote` and fall through a priced route into a free catch-all.
//! Matching is also case-insensitive (see `pricer`), because Express and IIS route that way.

/// Returns the canonical form of a request path: query dropped, percent-decoded,
/// `;matrix` parameters dropped per segment (Java servlet containers ignore them), `\` read
/// as `/`, duplicate slashes collapsed, `.`/`..` resolved, no trailing slash.
pub fn normalize(raw: &str) -> String {
    let without_query = raw.split_once('?').map_or(raw, |(p, _)| p);
    let decoded = percent_decode(without_query).replace('\\', "/");
    let mut segments: Vec<&str> = Vec::new();
    for seg in decoded.split('/') {
        let seg = seg.split_once(';').map_or(seg, |(s, _)| s);
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
            ("/api/quote?x=1", "/api/quote"),
            ("/api/quote;jsessionid=1", "/api/quote"),
            ("/api;v=2/quote", "/api/quote"),
            ("/api\\quote", "/api/quote"),
            ("/api/%3Bx", "/api"),
        ];
        for (input, want) in cases {
            assert_eq!(normalize(input), want, "{input:?}");
        }
    }
}
