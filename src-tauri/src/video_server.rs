use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

/// Max chunk size per response: 32 MB.
const MAX_CHUNK: u64 = 32 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct VideoServerInfo {
    pub port: u16,
    pub access_token: String,
}

/// Start a localhost-only HTTP video server on an OS-assigned port.
/// Returns the port and a random access token used to authenticate requests.
pub fn start_video_server() -> VideoServerInfo {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind video server");
    let port = listener.local_addr().unwrap().port();
    let access_token = uuid::Uuid::new_v4().to_string();

    let token = access_token.clone();
    std::thread::Builder::new()
        .name("video-server".into())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(conn) => {
                        let t = token.clone();
                        std::thread::spawn(move || handle_connection(conn, &t));
                    }
                    Err(e) => {
                        eprintln!("[video-server] accept error: {e}");
                    }
                }
            }
        })
        .expect("Failed to spawn video-server thread");

    eprintln!("[video-server] listening on 127.0.0.1:{port}");
    VideoServerInfo { port, access_token }
}

/// Return MIME type for a video file based on its extension.
fn get_video_mime_type(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("ogg") | Some("ogv") => "video/ogg",
        Some("mov") => "video/quicktime",
        Some("avi") => "video/x-msvideo",
        Some("mkv") => "video/x-matroska",
        Some("ts") | Some("m2ts") => "video/mp2t",
        Some("flv") => "video/x-flv",
        _ => "application/octet-stream",
    }
}

/// Parse an HTTP Range header value against the given file size.
/// Supports formats: `bytes=0-499`, `bytes=500-`, `bytes=-500`.
fn parse_range_header(range: &str, file_size: u64) -> Option<(u64, u64)> {
    let range = range.strip_prefix("bytes=")?;
    if let Some(suffix) = range.strip_prefix('-') {
        let len: u64 = suffix.parse().ok()?;
        if len == 0 || len > file_size {
            return None;
        }
        Some((file_size - len, file_size - 1))
    } else if let Some(start_str) = range.strip_suffix('-') {
        let start: u64 = start_str.parse().ok()?;
        if start >= file_size {
            return None;
        }
        Some((start, file_size - 1))
    } else {
        let mut parts = range.splitn(2, '-');
        let start: u64 = parts.next()?.parse().ok()?;
        let end: u64 = parts.next()?.parse().ok()?;
        if start > end || start >= file_size {
            return None;
        }
        Some((start, end.min(file_size - 1)))
    }
}

// ---------------------------------------------------------------------------
// HTTP handling
// ---------------------------------------------------------------------------

fn handle_connection(mut stream: TcpStream, access_token: &str) {
    // Verify loopback
    if let Ok(peer) = stream.peer_addr() {
        if !peer.ip().is_loopback() {
            let _ = write_response(&mut stream, 403, "Forbidden", "text/plain", b"Forbidden");
            return;
        }
    } else {
        return;
    }

    // Timeouts
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(60)));

    let mut reader = BufReader::new(stream.try_clone().unwrap());

    // Read request line
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }

    // Parse method and path
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let raw_path = parts[1]; // e.g. /D%3A/foo.mp4?access_token=xxx

    // Read headers
    let mut headers: Vec<(String, String)> = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }

    // Handle CORS preflight
    if method.eq_ignore_ascii_case("OPTIONS") {
        let resp = format!(
            "HTTP/1.1 204 No Content\r\n\
             Access-Control-Allow-Origin: *\r\n\
             Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
             Access-Control-Allow-Headers: Range\r\n\
             Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
             Content-Length: 0\r\n\
             Connection: close\r\n\
             \r\n"
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if !method.eq_ignore_ascii_case("GET") && !method.eq_ignore_ascii_case("HEAD") {
        let resp = format!(
            "HTTP/1.1 405 Method Not Allowed\r\n\
             Allow: GET, HEAD, OPTIONS\r\n\
             Content-Length: 0\r\n\
             Access-Control-Allow-Origin: *\r\n\
             Connection: close\r\n\
             \r\n"
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    // Split path and query
    let (path, query) = raw_path.split_once('?').unwrap_or((raw_path, ""));

    // Validate access_token
    let token_ok = query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .any(|(k, v)| k == "access_token" && v == access_token);

    if !token_ok {
        let _ = write_response(&mut stream, 403, "Forbidden", "text/plain", b"Invalid token");
        return;
    }

    // Decode file path (skip leading /)
    let encoded_path = if let Some(stripped) = path.strip_prefix('/') {
        stripped
    } else {
        path
    };
    let file_path = match urlencoding::decode(encoded_path) {
        Ok(p) => p.into_owned(),
        Err(_) => {
            let _ = write_response(
                &mut stream,
                400,
                "Bad Request",
                "text/plain",
                b"Invalid path encoding",
            );
            return;
        }
    };

    // Validate MIME type is video
    let mime = get_video_mime_type(&file_path);
    if mime == "application/octet-stream" {
        let _ = write_response(
            &mut stream,
            403,
            "Forbidden",
            "text/plain",
            b"Not a video file",
        );
        return;
    }

    // Open file
    let mut file = match File::open(&file_path) {
        Ok(f) => f,
        Err(_) => {
            let _ = write_response(&mut stream, 404, "Not Found", "text/plain", b"File not found");
            return;
        }
    };

    let file_size = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => {
            let _ = write_response(
                &mut stream,
                500,
                "Internal Server Error",
                "text/plain",
                b"Cannot read metadata",
            );
            return;
        }
    };

    // Find Range header
    let range_header = headers
        .iter()
        .find(|(k, _)| k == "range")
        .map(|(_, v)| v.clone());

    let is_head = method.eq_ignore_ascii_case("HEAD");

    if let Some(ref range_val) = range_header {
        let is_multi_range = range_val.contains(',');

        if is_multi_range {
            let header = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: {mime}\r\n\
                 Content-Length: {file_size}\r\n\
                 Accept-Ranges: bytes\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
                 Connection: close\r\n\
                 \r\n"
            );
            let _ = stream.write_all(header.as_bytes());
            if !is_head {
                let _ = io::copy(&mut file, &mut stream);
            }
            return;
        }

        if let Some((start, requested_end)) = parse_range_header(range_val, file_size) {
            let end = requested_end.min(start + MAX_CHUNK - 1).min(file_size - 1);
            let length = end - start + 1;

            if file.seek(SeekFrom::Start(start)).is_err() {
                let _ = write_response(
                    &mut stream,
                    500,
                    "Internal Server Error",
                    "text/plain",
                    b"Seek failed",
                );
                return;
            }

            let resp_header = format!(
                "HTTP/1.1 206 Partial Content\r\n\
                 Content-Type: {mime}\r\n\
                 Content-Length: {length}\r\n\
                 Content-Range: bytes {start}-{end}/{file_size}\r\n\
                 Accept-Ranges: bytes\r\n\
                 Connection: close\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
                 \r\n"
            );
            let _ = stream.write_all(resp_header.as_bytes());

            if !is_head {
                let mut limited = file.take(length);
                let _ = io::copy(&mut limited, &mut stream);
            }
        } else {
            // Invalid range
            let body = b"Range Not Satisfiable";
            let resp = format!(
                "HTTP/1.1 416 Range Not Satisfiable\r\n\
                 Content-Range: bytes */{file_size}\r\n\
                 Content-Length: {}\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Connection: close\r\n\
                 \r\n",
                body.len()
            );
            let _ = stream.write_all(resp.as_bytes());
            if !is_head {
                let _ = stream.write_all(body);
            }
        }
    } else {
        let resp_header = format!(
            "HTTP/1.1 200 OK\r\n\
             Content-Type: {mime}\r\n\
             Content-Length: {file_size}\r\n\
             Accept-Ranges: bytes\r\n\
             Connection: close\r\n\
             Access-Control-Allow-Origin: *\r\n\
             Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\
             \r\n"
        );
        let _ = stream.write_all(resp_header.as_bytes());

        if !is_head {
            let _ = io::copy(&mut file, &mut stream);
        }
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\
         \r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body)?;
    Ok(())
}
