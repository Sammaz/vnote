use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleEntry {
    pub index: usize,
    pub start_time: f64, // seconds
    pub end_time: f64,   // seconds
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SubtitleFormat {
    SRT,
    VTT,
    ASS,
}

impl SubtitleFormat {
    pub fn from_path(path: &str) -> Option<Self> {
        let ext = Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())?;

        match ext.as_str() {
            "srt" => Some(SubtitleFormat::SRT),
            "vtt" | "webvtt" => Some(SubtitleFormat::VTT),
            "ass" | "ssa" => Some(SubtitleFormat::ASS),
            _ => None,
        }
    }
}

/// Parse a subtitle file and return entries
pub fn parse_subtitle_file(path: &str) -> Result<Vec<SubtitleEntry>, String> {
    let format = SubtitleFormat::from_path(path).ok_or("Unsupported subtitle format")?;

    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    match format {
        SubtitleFormat::SRT => parse_srt(&content),
        SubtitleFormat::VTT => parse_vtt(&content),
        SubtitleFormat::ASS => parse_ass(&content),
    }
}

/// Parse SRT format subtitles
fn parse_srt(content: &str) -> Result<Vec<SubtitleEntry>, String> {
    let mut entries = Vec::new();
    let blocks: Vec<&str> = content.split("\n\n").collect();

    // SRT time format: 00:00:00,000 --> 00:00:00,000
    let time_regex =
        Regex::new(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")
            .unwrap();

    for block in blocks {
        let lines: Vec<&str> = block.trim().lines().collect();
        if lines.len() < 3 {
            continue;
        }

        // First line is index
        let index: usize = match lines[0].trim().parse() {
            Ok(i) => i,
            Err(_) => continue,
        };

        // Second line is timestamp
        let time_line = lines[1].trim();
        let caps = match time_regex.captures(time_line) {
            Some(c) => c,
            None => continue,
        };

        let start_time = parse_time_components(
            caps.get(1).unwrap().as_str(),
            caps.get(2).unwrap().as_str(),
            caps.get(3).unwrap().as_str(),
            caps.get(4).unwrap().as_str(),
        );

        let end_time = parse_time_components(
            caps.get(5).unwrap().as_str(),
            caps.get(6).unwrap().as_str(),
            caps.get(7).unwrap().as_str(),
            caps.get(8).unwrap().as_str(),
        );

        // Remaining lines are text
        let text = lines[2..].join("\n").trim().to_string();

        if !text.is_empty() {
            entries.push(SubtitleEntry {
                index,
                start_time,
                end_time,
                text: clean_subtitle_text(&text),
            });
        }
    }

    Ok(entries)
}

/// Parse VTT format subtitles
fn parse_vtt(content: &str) -> Result<Vec<SubtitleEntry>, String> {
    let mut entries = Vec::new();

    // Remove WEBVTT header and any metadata
    let content = content
        .lines()
        .skip_while(|line| {
            let trimmed = line.trim();
            trimmed.starts_with("WEBVTT")
                || trimmed.starts_with("Kind:")
                || trimmed.starts_with("Language:")
                || trimmed.is_empty()
        })
        .collect::<Vec<&str>>()
        .join("\n");

    let blocks: Vec<&str> = content.split("\n\n").collect();

    // VTT time format: 00:00:00.000 --> 00:00:00.000
    let time_regex = Regex::new(
        r"(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})",
    )
    .unwrap();

    let mut index = 0;
    for block in blocks {
        let lines: Vec<&str> = block.trim().lines().collect();
        if lines.is_empty() {
            continue;
        }

        // Find the timestamp line
        let mut time_line_idx = 0;
        for (i, line) in lines.iter().enumerate() {
            if line.contains("-->") {
                time_line_idx = i;
                break;
            }
        }

        let time_line = lines[time_line_idx].trim();
        let caps = match time_regex.captures(time_line) {
            Some(c) => c,
            None => continue,
        };

        let start_hours = caps.get(1).map(|m| m.as_str()).unwrap_or("00");
        let start_time = parse_time_components(
            start_hours,
            caps.get(2).unwrap().as_str(),
            caps.get(3).unwrap().as_str(),
            caps.get(4).unwrap().as_str(),
        );

        let end_hours = caps.get(5).map(|m| m.as_str()).unwrap_or("00");
        let end_time = parse_time_components(
            end_hours,
            caps.get(6).unwrap().as_str(),
            caps.get(7).unwrap().as_str(),
            caps.get(8).unwrap().as_str(),
        );

        // Text is after timestamp line
        let text = lines[time_line_idx + 1..].join("\n").trim().to_string();

        if !text.is_empty() {
            index += 1;
            entries.push(SubtitleEntry {
                index,
                start_time,
                end_time,
                text: clean_subtitle_text(&text),
            });
        }
    }

    Ok(entries)
}

/// Parse ASS/SSA format subtitles
fn parse_ass(content: &str) -> Result<Vec<SubtitleEntry>, String> {
    let mut entries = Vec::new();

    // ASS Dialogue format: Dialogue: 0,0:00:00.00,0:00:00.00,Style,,0,0,0,,Text
    let dialogue_regex =
        Regex::new(r"^Dialogue:\s*\d+,(\d+):(\d{2}):(\d{2})\.(\d{2}),(\d+):(\d{2}):(\d{2})\.(\d{2}),[^,]*,[^,]*,\d+,\d+,\d+,[^,]*,(.*)$")
            .unwrap();

    // Alternative format with fewer fields
    let dialogue_regex_simple =
        Regex::new(r"^Dialogue:\s*\d+,(\d+):(\d{2}):(\d{2})\.(\d{2}),(\d+):(\d{2}):(\d{2})\.(\d{2}),.*?,.*?,.*?,.*?,.*?,(.*)$")
            .unwrap();

    let mut index = 0;
    for line in content.lines() {
        let line = line.trim();
        if !line.starts_with("Dialogue:") {
            continue;
        }

        let caps = dialogue_regex
            .captures(line)
            .or_else(|| dialogue_regex_simple.captures(line));

        let caps = match caps {
            Some(c) => c,
            None => continue,
        };

        // ASS uses centiseconds (2 digits)
        let start_time = parse_time_components_ass(
            caps.get(1).unwrap().as_str(),
            caps.get(2).unwrap().as_str(),
            caps.get(3).unwrap().as_str(),
            caps.get(4).unwrap().as_str(),
        );

        let end_time = parse_time_components_ass(
            caps.get(5).unwrap().as_str(),
            caps.get(6).unwrap().as_str(),
            caps.get(7).unwrap().as_str(),
            caps.get(8).unwrap().as_str(),
        );

        let text = caps.get(9).map(|m| m.as_str()).unwrap_or("");

        // Clean ASS tags and formatting
        let cleaned_text = clean_ass_text(text);

        if !cleaned_text.is_empty() {
            index += 1;
            entries.push(SubtitleEntry {
                index,
                start_time,
                end_time,
                text: cleaned_text,
            });
        }
    }

    Ok(entries)
}

/// Parse time components into seconds
fn parse_time_components(hours: &str, minutes: &str, seconds: &str, millis: &str) -> f64 {
    let h: f64 = hours.parse().unwrap_or(0.0);
    let m: f64 = minutes.parse().unwrap_or(0.0);
    let s: f64 = seconds.parse().unwrap_or(0.0);
    let ms: f64 = millis.parse().unwrap_or(0.0);

    h * 3600.0 + m * 60.0 + s + ms / 1000.0
}

/// Parse ASS time components (centiseconds instead of milliseconds)
fn parse_time_components_ass(hours: &str, minutes: &str, seconds: &str, centis: &str) -> f64 {
    let h: f64 = hours.parse().unwrap_or(0.0);
    let m: f64 = minutes.parse().unwrap_or(0.0);
    let s: f64 = seconds.parse().unwrap_or(0.0);
    let cs: f64 = centis.parse().unwrap_or(0.0);

    h * 3600.0 + m * 60.0 + s + cs / 100.0
}

/// Clean ASS formatting tags
fn clean_ass_text(text: &str) -> String {
    // Remove ASS override tags like {\pos(x,y)}, {\fad(100,200)}, {\b1}, etc.
    let tag_regex = Regex::new(r"\{[^}]*\}").unwrap();
    let cleaned = tag_regex.replace_all(text, "");

    // Replace \N with newline
    let cleaned = cleaned.replace("\\N", "\n").replace("\\n", "\n");

    // Clean up whitespace
    cleaned.trim().to_string()
}

/// Clean common subtitle formatting
fn clean_subtitle_text(text: &str) -> String {
    // Remove HTML-like tags
    let html_regex = Regex::new(r"<[^>]+>").unwrap();
    let cleaned = html_regex.replace_all(text, "");

    // Remove music symbols and common markers
    let cleaned = cleaned
        .replace("♪", "")
        .replace("♫", "")
        .replace("[音楽]", "")
        .replace("[Music]", "");

    cleaned.trim().to_string()
}

/// Format seconds to timestamp string (HH:MM:SS)
pub fn format_timestamp(seconds: f64) -> String {
    let hours = (seconds / 3600.0).floor() as u32;
    let minutes = ((seconds % 3600.0) / 60.0).floor() as u32;
    let secs = (seconds % 60.0).floor() as u32;

    format!("{:02}:{:02}:{:02}", hours, minutes, secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_time_components() {
        assert_eq!(parse_time_components("00", "01", "30", "500"), 90.5);
        assert_eq!(parse_time_components("01", "00", "00", "000"), 3600.0);
    }

    #[test]
    fn test_clean_ass_text() {
        assert_eq!(
            clean_ass_text(r"{\pos(100,200)}Hello World"),
            "Hello World"
        );
        assert_eq!(
            clean_ass_text(r"{\b1}Bold{\b0} Text"),
            "Bold Text"
        );
        assert_eq!(clean_ass_text(r"Line1\NLine2"), "Line1\nLine2");
    }

    #[test]
    fn test_format_timestamp() {
        assert_eq!(format_timestamp(90.5), "00:01:30");
        assert_eq!(format_timestamp(3661.0), "01:01:01");
    }
}
