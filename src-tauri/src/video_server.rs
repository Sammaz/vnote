use axum::{
    body::{Body, Bytes},
    extract::{Query, Request},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;

/// Stream read buffer size: 64 KB.
const STREAM_BUF: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub struct VideoServerInfo {
    pub port: u16,
    pub access_token: String,
}

/// Start a localhost-only HTTP video server on an OS-assigned port.
/// Returns the port and a random access token used to authenticate requests.
pub fn start_video_server() -> VideoServerInfo {
    // Bind synchronously so the port is known immediately.
    let std_listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("Failed to bind video server");
    std_listener
        .set_nonblocking(true)
        .expect("Failed to set non-blocking");
    let port = std_listener.local_addr().unwrap().port();
    let access_token = uuid::Uuid::new_v4().to_string();

    let token = access_token.clone();
    std::thread::Builder::new()
        .name("video-server".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("Failed to build tokio runtime for video server");

            rt.block_on(async move {
                let listener = tokio::net::TcpListener::from_std(std_listener)
                    .expect("Failed to convert to tokio TcpListener");

                let app = Router::new()
                    .route("/{*path}", get(handle_video).head(handle_video))
                    .layer(middleware::from_fn(move |req, next| {
                        let t = token.clone();
                        auth_middleware(t, req, next)
                    }))
                    .layer(
                        CorsLayer::new()
                            .allow_origin(tower_http::cors::Any)
                            .allow_methods(tower_http::cors::Any)
                            .allow_headers(tower_http::cors::Any)
                            .expose_headers([
                                header::CONTENT_RANGE,
                                header::CONTENT_LENGTH,
                                header::ACCEPT_RANGES,
                            ]),
                    );

                eprintln!("[video-server] listening on 127.0.0.1:{port}");
                axum::serve(listener, app)
                    .await
                    .expect("Video server failed");
            });
        })
        .expect("Failed to spawn video-server thread");

    VideoServerInfo { port, access_token }
}

// ---------------------------------------------------------------------------
// Middleware: verify localhost + access_token
// ---------------------------------------------------------------------------

async fn auth_middleware(expected_token: String, req: Request, next: Next) -> Response {
    // Extract access_token from query string
    let query: Query<HashMap<String, String>> =
        Query::try_from_uri(req.uri()).unwrap_or_else(|_| Query(HashMap::new()));

    let token_ok = query
        .get("access_token")
        .map(|t| t == &expected_token)
        .unwrap_or(false);

    if !token_ok {
        return (StatusCode::FORBIDDEN, "Invalid token").into_response();
    }

    next.run(req).await
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async fn handle_video(
    axum::extract::Path(encoded_path): axum::extract::Path<String>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    let is_head = req.method() == axum::http::Method::HEAD;

    // Decode file path
    let file_path = match urlencoding::decode(&encoded_path) {
        Ok(p) => p.into_owned(),
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid path encoding").into_response(),
    };

    // Validate MIME type is video
    let mime = get_video_mime_type(&file_path);
    if mime == "application/octet-stream" {
        return (StatusCode::FORBIDDEN, "Not a video file").into_response();
    }

    // Open file and get metadata in a blocking thread
    let path_clone = file_path.clone();
    let file_info = tokio::task::spawn_blocking(move || {
        let file = File::open(&path_clone)?;
        let metadata = file.metadata()?;
        Ok::<(File, u64), std::io::Error>((file, metadata.len()))
    })
    .await;

    let (file, file_size) = match file_info {
        Ok(Ok((f, s))) => (f, s),
        Ok(Err(_)) => return (StatusCode::NOT_FOUND, "File not found").into_response(),
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Task join error").into_response()
        }
    };

    // Common headers
    let mut common_headers = HeaderMap::new();
    common_headers.insert(header::CONTENT_TYPE, mime.parse().unwrap());
    common_headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());

    // Check Range header
    let range_header = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(ref range_val) = range_header {
        if file_size == 0 {
            let mut h = HeaderMap::new();
            h.insert(header::CONTENT_RANGE, "bytes */0".parse().unwrap());
            return (StatusCode::RANGE_NOT_SATISFIABLE, h, "Range Not Satisfiable")
                .into_response();
        }

        // Multi-range requests are served as the first range only.
        let range_for_parse = range_val
            .split(',')
            .next()
            .map(str::trim)
            .unwrap_or(range_val.as_str());

        match parse_range_header(range_for_parse, file_size) {
            Some((start, requested_end)) => {
                let end = requested_end.min(file_size - 1);
                let length = end - start + 1;

                common_headers.insert(header::CONTENT_LENGTH, length.into());
                common_headers.insert(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{file_size}").parse().unwrap(),
                );

                if is_head {
                    return (StatusCode::PARTIAL_CONTENT, common_headers).into_response();
                }

                let body = Body::from_stream(stream_file_range(file, start, length));
                (StatusCode::PARTIAL_CONTENT, common_headers, body).into_response()
            }
            None => {
                let mut h = HeaderMap::new();
                h.insert(
                    header::CONTENT_RANGE,
                    format!("bytes */{file_size}").parse().unwrap(),
                );
                (StatusCode::RANGE_NOT_SATISFIABLE, h, "Range Not Satisfiable").into_response()
            }
        }
    } else {
        serve_full(file, file_size, common_headers, is_head)
    }
}

fn serve_full(
    file: File,
    file_size: u64,
    mut headers: HeaderMap,
    is_head: bool,
) -> Response {
    headers.insert(header::CONTENT_LENGTH, file_size.into());

    if is_head {
        return (StatusCode::OK, headers).into_response();
    }

    let body = Body::from_stream(stream_file_range(file, 0, file_size));
    (StatusCode::OK, headers, body).into_response()
}

/// Stream a byte range from a file using `spawn_blocking` + synchronous I/O.
/// Sends chunks through an mpsc channel consumed as a `Body::from_stream`.
fn stream_file_range(
    mut file: File,
    start: u64,
    length: u64,
) -> ReceiverStream<Result<Bytes, std::io::Error>> {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(4);

    tokio::task::spawn_blocking(move || {
        if let Err(e) = file.seek(SeekFrom::Start(start)) {
            let _ = tx.blocking_send(Err(e));
            return;
        }

        let mut remaining = length as usize;
        let mut buf = vec![0u8; STREAM_BUF];

        while remaining > 0 {
            let to_read = remaining.min(buf.len());
            match file.read(&mut buf[..to_read]) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    remaining -= n;
                    if tx
                        .blocking_send(Ok(Bytes::copy_from_slice(&buf[..n])))
                        .is_err()
                    {
                        return; // receiver dropped (client disconnected)
                    }
                }
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    return;
                }
            }
        }
    });

    ReceiverStream::new(rx)
}

// ---------------------------------------------------------------------------
// Utilities (preserved from original)
// ---------------------------------------------------------------------------

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
        if len == 0 {
            return None;
        }
        if len >= file_size {
            return Some((0, file_size - 1));
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
