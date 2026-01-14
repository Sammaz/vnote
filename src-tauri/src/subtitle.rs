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
    pub second_language_text: Option<String>, // 双语字幕的第二语言文本（可选）
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

    // 统一换行符：将 Windows 风格的 \r\n 转换为 Unix 风格的 \n
    let content = content.replace("\r\n", "\n").replace('\r', "\n");

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
                second_language_text: None,
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
                second_language_text: None,
            });
        }
    }

    Ok(entries)
}

/// Parse ASS/SSA format subtitles with bilingual support
fn parse_ass(content: &str) -> Result<Vec<SubtitleEntry>, String> {
    // 先解析 Styles，检测是否有双语
    let styles = parse_ass_styles(content);
    let has_bilingual = styles.len() > 1;

    // Dialogue 格式
    let dialogue_regex =
        Regex::new(r"^Dialogue:\s*\d+,(\d+):(\d{2}):(\d{2})\.(\d{2}),(\d+):(\d{2}):(\d{2})\.(\d{2}),([^,]*),[^,]*,\d+,\d+,\d+,[^,]*,(.*)$")
            .unwrap();

    let mut primary_entries: Vec<SubtitleEntry> = Vec::new();
    let mut secondary_entries: Vec<SubtitleEntry> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if !line.starts_with("Dialogue:") {
            continue;
        }

        let caps = dialogue_regex.captures(line);
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

        let style_name = caps.get(9).map(|m| m.as_str()).unwrap_or("Default");
        let text = caps.get(10).map(|m| m.as_str()).unwrap_or("");

        // Clean ASS tags and formatting
        let cleaned_text = clean_ass_text(text);

        if cleaned_text.is_empty() {
            continue;
        }

        let entry = SubtitleEntry {
            index: 0, // 稍后设置
            start_time,
            end_time,
            text: cleaned_text.clone(),
            second_language_text: None,
        };

        if has_bilingual {
            // 根据Style分类到主语言或第二语言
            let style_order = styles.iter().position(|s| s == style_name);
            if let Some(0) = style_order {
                primary_entries.push(entry);
            } else if style_order.is_some() {
                secondary_entries.push(entry);
            } else {
                // 未匹配到已知Style，放入主语言
                primary_entries.push(entry);
            }
        } else {
            // 单语模式
            primary_entries.push(entry);
        }
    }

    if has_bilingual {
        // 合并双语字幕：按时间范围匹配
        Ok(merge_bilingual_entries(primary_entries, secondary_entries))
    } else {
        // 单语字幕：直接设置索引并返回
        let mut result = Vec::new();
        for (i, entry) in primary_entries.into_iter().enumerate() {
            result.push(SubtitleEntry {
                index: i + 1,
                ..entry
            });
        }
        Ok(result)
    }
}

/// 解析 ASS 文件中的 Styles，返回按顺序排列的 Style 名称列表
fn parse_ass_styles(content: &str) -> Vec<String> {
    let mut styles = Vec::new();
    let style_regex = Regex::new(r"^Style:\s*([^,]+)").unwrap();

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("Style:") {
            if let Some(caps) = style_regex.captures(line) {
                if let Some(style_name) = caps.get(1) {
                    let name = style_name.as_str().to_string();
                    // 排除默认的 Default 避免重复
                    if !styles.iter().any(|s| s == &name) {
                        styles.push(name);
                    }
                }
            }
        }
    }

    // 如果没有找到 Styles 或者只有 Default，返回单语模式
    if styles.is_empty() || (styles.len() == 1 && styles[0] == "Default") {
        vec!["Default".to_string()]
    } else {
        styles
    }
}

/// 合并双语字幕条目
fn merge_bilingual_entries(
    primary: Vec<SubtitleEntry>,
    secondary: Vec<SubtitleEntry>,
) -> Vec<SubtitleEntry> {
    let mut result = Vec::new();

    for (i, mut prim_entry) in primary.into_iter().enumerate() {
        prim_entry.index = i + 1;

        // 查找时间范围重叠的二级语言字幕
        let sec_text = secondary.iter().find(|sec| {
            // 检查时间范围是否有重叠（容差 1 秒）
            let start_overlap = sec.start_time <= prim_entry.end_time + 1.0;
            let end_overlap = sec.end_time >= prim_entry.start_time - 1.0;
            start_overlap && end_overlap
        }).map(|sec| sec.text.clone());

        prim_entry.second_language_text = sec_text;
        result.push(prim_entry);
    }

    result
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
