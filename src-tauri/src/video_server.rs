use http_range::HttpRange;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::{header, Response, StatusCode};

/// Maximum bytes to serve in a single response (10 MB).
const MAX_RANGE_LEN: u64 = 10 * 1024 * 1024;

/// Handle requests on the `video-stream://` custom protocol.
///
/// URL format: `http://video-stream.localhost/<url-encoded-file-path>`
///
/// Supports Range requests for efficient video seeking.
pub fn handle_video_protocol(
    _ctx: tauri::UriSchemeContext<'_, impl tauri::Runtime>,
    request: tauri::http::Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let uri_path = request.uri().path();

    // Skip leading '/' from the URI path
    let raw_path = if uri_path.starts_with('/') {
        &uri_path[1..]
    } else {
        uri_path
    };

    // Decode percent-encoded file path
    let file_path = match urlencoding::decode(raw_path) {
        Ok(p) => p.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
                .body(b"Invalid path encoding".to_vec())
                .unwrap();
        }
    };

    // Validate MIME type is a recognized video format
    let mime = get_video_mime_type(&file_path);
    if mime == "application/octet-stream" {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
            .body(b"Not a video file".to_vec())
            .unwrap();
    }

    // Open file and get size
    let mut file = match File::open(&file_path) {
        Ok(f) => f,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
                .body(b"File not found".to_vec())
                .unwrap();
        }
    };
    let file_size = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
                .body(b"Cannot read file metadata".to_vec())
                .unwrap();
        }
    };

    // Parse Range header
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());

    let (start, length) = if let Some(range_val) = range_header {
        // Parse the Range header
        match HttpRange::parse(range_val, file_size) {
            Ok(ranges) if !ranges.is_empty() => {
                let range = &ranges[0]; // Use first range only
                let start = range.start;
                let len = range.length.min(MAX_RANGE_LEN);
                (start, len)
            }
            _ => {
                // Malformed range
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(
                        header::CONTENT_RANGE,
                        format!("bytes */{file_size}"),
                    )
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
                    .body(b"Range Not Satisfiable".to_vec())
                    .unwrap();
            }
        }
    } else if file_size > MAX_RANGE_LEN {
        // No Range header + large file: serve first chunk as 206 so
        // the browser will follow up with proper Range requests.
        (0, MAX_RANGE_LEN)
    } else {
        // No Range + small file: serve the whole thing as 200
        let mut buf = vec![0u8; file_size as usize];
        if let Err(_) = file.read_exact(&mut buf) {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(b"Read error".to_vec())
                .unwrap();
        }
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_LENGTH, file_size)
            .header(header::ACCEPT_RANGES, "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
            .body(buf)
            .unwrap();
    };

    // Read the requested range
    let end = start + length - 1; // inclusive end
    let mut buf = vec![0u8; length as usize];
    if let Err(_) = file.seek(SeekFrom::Start(start)) {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
            .body(b"Seek error".to_vec())
            .unwrap();
    }
    if let Err(_) = file.read_exact(&mut buf) {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
            .body(b"Read error".to_vec())
            .unwrap();
    }

    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, length)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{file_size}"),
        )
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Expose-Headers", "content-range, content-length, accept-ranges")
        .body(buf)
        .unwrap()
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
