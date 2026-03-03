use axum::{
    body::Body,
    extract::{Query, Request},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

/// Max chunk size per response: 2 MB (keep-alive makes small chunks cheap).
const MAX_CHUNK: u64 = 2 * 1024 * 1024;

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
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to build tokio runtime for video server");

            rt.block_on(async move {
                let listener = tokio::net::TcpListener::from_std(std_listener)
                    .expect("Failed to convert to tokio TcpListener");

                let app = Router::new()
                    .route("/*path", get(handle_video).head(handle_video))
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

    // Open file
    let file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => return (StatusCode::NOT_FOUND, "File not found").into_response(),
    };

    let metadata = match file.metadata().await {
        Ok(m) => m,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Cannot read metadata").into_response()
        }
    };
    let file_size = metadata.len();

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
        // Multi-range → fall back to full 200
        if range_val.contains(',') {
            return serve_full(file, file_size, common_headers, is_head).await;
        }

        match parse_range_header(range_val, file_size) {
            Some((start, requested_end)) => {
                let end = requested_end.min(start + MAX_CHUNK - 1).min(file_size - 1);
                let length = end - start + 1;

                common_headers.insert(header::CONTENT_LENGTH, length.into());
                common_headers.insert(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{file_size}").parse().unwrap(),
                );

                if is_head {
                    return (StatusCode::PARTIAL_CONTENT, common_headers).into_response();
                }

                // Seek and stream
                let mut file = file;
                if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Seek failed").into_response();
                }

                let limited = file.take(length);
                let stream = ReaderStream::with_capacity(limited, STREAM_BUF);
                let body = Body::from_stream(stream);

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
        serve_full(file, file_size, common_headers, is_head).await
    }
}

async fn serve_full(
    file: tokio::fs::File,
    file_size: u64,
    mut headers: HeaderMap,
    is_head: bool,
) -> Response {
    headers.insert(header::CONTENT_LENGTH, file_size.into());

    if is_head {
        return (StatusCode::OK, headers).into_response();
    }

    let stream = ReaderStream::with_capacity(file, STREAM_BUF);
    let body = Body::from_stream(stream);
    (StatusCode::OK, headers, body).into_response()
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
