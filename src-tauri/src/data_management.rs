use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::chapter::{ChapterData, DetailedReadingData};
use crate::db::{Database, ScreenshotMarker};
use crate::storage_paths;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum DataCategoryKey {
    VideoMp4Cache,
    ChapterScreenshots,
    AiNoteScreenshots,
    AssistScreenshots,
    GeneratedSubtitlesAndAsrAssets,
    Logs,
    AppCache,
}

impl DataCategoryKey {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::VideoMp4Cache => "video_mp4_cache",
            Self::ChapterScreenshots => "chapter_screenshots",
            Self::AiNoteScreenshots => "ai_note_screenshots",
            Self::AssistScreenshots => "assist_screenshots",
            Self::GeneratedSubtitlesAndAsrAssets => "generated_subtitles_and_asr_assets",
            Self::Logs => "logs",
            Self::AppCache => "app_cache",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::VideoMp4Cache => "视频缓存",
            Self::ChapterScreenshots => "章节截图",
            Self::AiNoteScreenshots => "大纲笔记截图",
            Self::AssistScreenshots => "辅助截图",
            Self::GeneratedSubtitlesAndAsrAssets => "字幕与转录产物",
            Self::Logs => "日志文件",
            Self::AppCache => "应用缓存",
        }
    }

    pub fn all() -> &'static [Self] {
        &[
            Self::VideoMp4Cache,
            Self::ChapterScreenshots,
            Self::AiNoteScreenshots,
            Self::AssistScreenshots,
            Self::GeneratedSubtitlesAndAsrAssets,
            Self::Logs,
            Self::AppCache,
        ]
    }

    pub fn from_key(key: &str) -> Option<Self> {
        Self::all().iter().copied().find(|item| item.as_str() == key)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataCategoryStat {
    pub key: String,
    pub label: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub note_count: Option<u64>,
    pub reclaimable_bytes: u64,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataManagementOverview {
    pub data_root: String,
    pub total_size_bytes: u64,
    pub total_file_count: u64,
    pub reclaimable_bytes: u64,
    pub categories: Vec<DataCategoryStat>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CleanupCandidateGroup {
    pub key: String,
    pub label: String,
    pub reclaimable_bytes: u64,
    pub items_count: u64,
    pub sample_paths: Vec<String>,
    pub risk_level: String,
    pub requires_confirmation: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IntegrityIssue {
    pub note_id: Option<String>,
    pub path: String,
    pub detail: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IntegrityReport {
    pub db_orphans_count: u64,
    pub fs_orphans_count: u64,
    pub broken_assets_count: u64,
    pub examples: Vec<IntegrityIssue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SourceHealthIssue {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SourceHealthReport {
    pub missing_video_count: u64,
    pub missing_subtitle_count: u64,
    pub issues: Vec<SourceHealthIssue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataManagementScanResult {
    pub overview: DataManagementOverview,
    pub cleanup_candidates: Vec<CleanupCandidateGroup>,
    pub integrity_report: IntegrityReport,
    pub source_health_report: SourceHealthReport,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CleanupRequest {
    pub categories: Vec<String>,
    pub integrity_targets: Option<Vec<String>>,
    pub note_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CleanupPreview {
    pub groups: Vec<CleanupCandidateGroup>,
    pub total_bytes: u64,
    pub total_files: u64,
    pub total_items: u64,
    pub affected_note_ids: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CleanupResult {
    pub cleared_bytes: u64,
    pub deleted_files: u64,
    pub skipped_files: u64,
    pub processed_items: u64,
    pub failed_files: Vec<String>,
    pub affected_categories: Vec<String>,
    pub affected_note_ids: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct FileEntry {
    category: DataCategoryKey,
    note_id: Option<String>,
    path: PathBuf,
    size_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum IntegrityTargetKey {
    DbOrphans,
    FsOrphans,
    BrokenAssets,
}

impl IntegrityTargetKey {
    fn as_str(&self) -> &'static str {
        match self {
            Self::DbOrphans => "db_orphans",
            Self::FsOrphans => "fs_orphans",
            Self::BrokenAssets => "broken_assets",
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Self::DbOrphans => "数据库孤儿",
            Self::FsOrphans => "文件孤儿",
            Self::BrokenAssets => "失效资源",
        }
    }

    fn from_key(key: &str) -> Option<Self> {
        [Self::DbOrphans, Self::FsOrphans, Self::BrokenAssets]
            .into_iter()
            .find(|item| item.as_str() == key)
    }
}

#[derive(Debug, Clone)]
enum CleanupOperation {
    DeletePath {
        target_key: String,
        note_id: Option<String>,
        path: PathBuf,
        size_bytes: u64,
    },
    DeleteMarker {
        note_id: String,
        marker_id: String,
        path: String,
    },
    UpdateDetailedReading {
        note_id: String,
        path: String,
        updated_json: String,
    },
    UpdateAiNoteMarkdown {
        note_id: String,
        path: String,
        updated_markdown: String,
    },
}

#[derive(Debug, Clone)]
struct CategoryAccumulator {
    size_bytes: u64,
    file_count: u64,
    note_ids: HashSet<String>,
}

impl CategoryAccumulator {
    fn add(&mut self, note_id: Option<&str>, size_bytes: u64) {
        self.size_bytes += size_bytes;
        self.file_count += 1;
        if let Some(note_id) = note_id {
            self.note_ids.insert(note_id.to_string());
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataManagementNoteSummary {
    pub id: String,
    pub title: String,
    pub video_path: String,
    pub subtitle_path: Option<String>,
    pub detailed_reading: Option<String>,
    pub ai_note_markdown: Option<String>,
}

pub fn get_overview(app: &AppHandle, db: &Database, note_ids: Option<&[String]>) -> Result<DataManagementOverview, String> {
    let scan = scan_internal(app, db, note_ids)?;
    Ok(scan.overview)
}

pub fn scan(app: &AppHandle, db: &Database, note_ids: Option<&[String]>) -> Result<DataManagementScanResult, String> {
    scan_internal(app, db, note_ids)
}

pub fn preview_cleanup(app: &AppHandle, db: &Database, request: CleanupRequest) -> Result<CleanupPreview, String> {
    let note_ids = request.note_ids.as_deref();
    let operations = collect_cleanup_operations(app, db, &request.categories, request.integrity_targets.as_deref(), note_ids)?;
    Ok(build_cleanup_preview(&operations))
}

pub fn execute_cleanup(app: &AppHandle, db: &Database, request: CleanupRequest) -> Result<CleanupResult, String> {
    let note_ids = request.note_ids.as_deref();
    let operations = collect_cleanup_operations(app, db, &request.categories, request.integrity_targets.as_deref(), note_ids)?;

    let mut cleared_bytes = 0u64;
    let mut deleted_files = 0u64;
    let mut skipped_files = 0u64;
    let mut processed_items = 0u64;
    let mut failed_files = Vec::new();
    let mut affected_categories = HashSet::new();
    let mut affected_note_ids = HashSet::new();

    for operation in operations {
        match operation {
            CleanupOperation::DeletePath { target_key, note_id, path, size_bytes } => {
                if !path.exists() {
                    skipped_files += 1;
                    continue;
                }

                let delete_result = if path.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };

                match delete_result {
                    Ok(_) => {
                        cleared_bytes += size_bytes;
                        deleted_files += 1;
                        processed_items += 1;
                        affected_categories.insert(target_key);
                        if let Some(note_id) = note_id {
                            affected_note_ids.insert(note_id);
                        }
                    }
                    Err(err) => {
                        failed_files.push(format!("{}: {}", path.display(), err));
                    }
                }
            }
            CleanupOperation::DeleteMarker { note_id, marker_id, path } => {
                match db.delete_screenshot_marker(&note_id, &marker_id).map_err(|e| e.to_string())? {
                    Some(_) => {
                        processed_items += 1;
                        affected_categories.insert(IntegrityTargetKey::DbOrphans.as_str().to_string());
                        affected_note_ids.insert(note_id);
                    }
                    None => {
                        skipped_files += 1;
                    }
                }
                let _ = path;
            }
            CleanupOperation::UpdateDetailedReading { note_id, updated_json, .. } => {
                let mut note = db
                    .get_note_by_id(&note_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| format!("笔记不存在: {}", note_id))?;
                note.detailed_reading = Some(updated_json);
                db.update_note(&note).map_err(|e| e.to_string())?;
                processed_items += 1;
                affected_categories.insert(IntegrityTargetKey::BrokenAssets.as_str().to_string());
                affected_note_ids.insert(note_id);
            }
            CleanupOperation::UpdateAiNoteMarkdown { note_id, updated_markdown, .. } => {
                let mut note = db
                    .get_note_by_id(&note_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| format!("笔记不存在: {}", note_id))?;
                note.ai_note_markdown = Some(updated_markdown);
                db.update_note(&note).map_err(|e| e.to_string())?;
                processed_items += 1;
                affected_categories.insert(IntegrityTargetKey::BrokenAssets.as_str().to_string());
                affected_note_ids.insert(note_id);
            }
        }
    }

    Ok(CleanupResult {
        cleared_bytes,
        deleted_files,
        skipped_files,
        processed_items,
        failed_files,
        affected_categories: sort_strings(affected_categories),
        affected_note_ids: sort_strings(affected_note_ids),
        warnings: Vec::new(),
    })
}

fn scan_internal(app: &AppHandle, db: &Database, note_ids: Option<&[String]>) -> Result<DataManagementScanResult, String> {
    let notes = get_notes_for_scan(db, note_ids)?;
    let note_id_set: HashSet<String> = notes.iter().map(|note| note.id.clone()).collect();
    let file_entries = collect_file_entries(app, &notes)?;

    let mut category_map: HashMap<DataCategoryKey, CategoryAccumulator> = HashMap::new();
    for category in DataCategoryKey::all() {
        category_map.insert(
            *category,
            CategoryAccumulator {
                size_bytes: 0,
                file_count: 0,
                note_ids: HashSet::new(),
            },
        );
    }

    for entry in &file_entries {
        if let Some(acc) = category_map.get_mut(&entry.category) {
            acc.add(entry.note_id.as_deref(), entry.size_bytes);
        }
    }

    let mut categories = Vec::new();
    let mut total_size_bytes = 0u64;
    let mut total_file_count = 0u64;

    for category in DataCategoryKey::all() {
        let acc = category_map.remove(category).unwrap_or(CategoryAccumulator {
            size_bytes: 0,
            file_count: 0,
            note_ids: HashSet::new(),
        });
        total_size_bytes += acc.size_bytes;
        total_file_count += acc.file_count;
        categories.push(DataCategoryStat {
            key: category.as_str().to_string(),
            label: category.label().to_string(),
            size_bytes: acc.size_bytes,
            file_count: acc.file_count,
            note_count: Some(acc.note_ids.len() as u64),
            reclaimable_bytes: acc.size_bytes,
            status: if acc.file_count > 0 { "ready".to_string() } else { "empty".to_string() },
        });
    }

    let cleanup_candidates = categories
        .iter()
        .filter(|item| item.file_count > 0)
        .map(|item| CleanupCandidateGroup {
            key: item.key.clone(),
            label: item.label.clone(),
            reclaimable_bytes: item.reclaimable_bytes,
            items_count: item.file_count,
            sample_paths: file_entries
                .iter()
                .filter(|entry| entry.category.as_str() == item.key)
                .take(5)
                .map(|entry| entry.path.to_string_lossy().to_string())
                .collect(),
            risk_level: risk_level_for_key(&item.key).to_string(),
            requires_confirmation: true,
        })
        .collect::<Vec<_>>();

    let integrity_report = build_integrity_report(app, db, &notes, &note_id_set)?;
    let source_health_report = build_source_health_report(&notes);
    let data_root = storage_paths::data_root(app)?.to_string_lossy().to_string();
    let reclaimable_bytes = categories.iter().map(|item| item.reclaimable_bytes).sum();

    Ok(DataManagementScanResult {
        overview: DataManagementOverview {
            data_root,
            total_size_bytes,
            total_file_count,
            reclaimable_bytes,
            categories,
        },
        cleanup_candidates,
        integrity_report,
        source_health_report,
    })
}

fn get_notes_for_scan(db: &Database, note_ids: Option<&[String]>) -> Result<Vec<DataManagementNoteSummary>, String> {
    let notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let filter_set = note_ids.map(|ids| ids.iter().cloned().collect::<HashSet<_>>());

    Ok(notes
        .into_iter()
        .filter(|note| {
            if let Some(filter_set) = &filter_set {
                filter_set.contains(&note.id)
            } else {
                true
            }
        })
        .map(|note| DataManagementNoteSummary {
            id: note.id,
            title: note.title,
            video_path: note.video_path,
            subtitle_path: note.subtitle_path,
            detailed_reading: note.detailed_reading,
            ai_note_markdown: note.ai_note_markdown,
        })
        .collect())
}

fn collect_cleanup_operations(
    app: &AppHandle,
    db: &Database,
    categories: &[String],
    integrity_targets: Option<&[String]>,
    note_ids: Option<&[String]>,
) -> Result<Vec<CleanupOperation>, String> {
    let notes = get_notes_for_scan(db, note_ids)?;
    let category_keys: HashSet<DataCategoryKey> = categories
        .iter()
        .filter_map(|key| DataCategoryKey::from_key(key))
        .collect();
    let integrity_keys: HashSet<IntegrityTargetKey> = integrity_targets
        .unwrap_or(&[])
        .iter()
        .filter_map(|key| IntegrityTargetKey::from_key(key))
        .collect();

    let mut operations = Vec::new();

    if !category_keys.is_empty() {
        let all_entries = collect_file_entries(app, &notes)?;
        operations.extend(all_entries.into_iter().filter_map(|entry| {
            if category_keys.contains(&entry.category) {
                Some(CleanupOperation::DeletePath {
                    target_key: entry.category.as_str().to_string(),
                    note_id: entry.note_id,
                    path: entry.path,
                    size_bytes: entry.size_bytes,
                })
            } else {
                None
            }
        }));
    }

    if !integrity_keys.is_empty() {
        operations.extend(collect_integrity_cleanup_operations(app, db, &notes, &integrity_keys, note_ids.is_none())?);
    }

    Ok(operations)
}

fn collect_file_entries(app: &AppHandle, notes: &[DataManagementNoteSummary]) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    for note in notes {
        let note_id = note.id.clone();
        let note_dir = storage_paths::note_dir(app, &note.id)?;
        if !note_dir.exists() {
            continue;
        }

        collect_matching_files(
            &note_dir,
            Some(note_id.clone()),
            DataCategoryKey::VideoMp4Cache,
            &mut entries,
            |path| path.is_file() && has_extension(path, &["mp4"]),
            &["chapter_screenshots", "ai_note_screenshots", "assist_screenshots", "subtitle"],
        )?;

        collect_dir_files(
            &storage_paths::chapter_screenshots_dir(app, &note.id)?,
            Some(note_id.clone()),
            DataCategoryKey::ChapterScreenshots,
            &mut entries,
        )?;
        collect_dir_files(
            &storage_paths::ai_note_screenshots_dir(app, &note.id)?,
            Some(note_id.clone()),
            DataCategoryKey::AiNoteScreenshots,
            &mut entries,
        )?;
        collect_dir_files(
            &storage_paths::assist_screenshots_dir(app, &note.id)?,
            Some(note_id.clone()),
            DataCategoryKey::AssistScreenshots,
            &mut entries,
        )?;
        collect_matching_files(
            &storage_paths::subtitle_dir(app, &note.id)?,
            Some(note_id),
            DataCategoryKey::GeneratedSubtitlesAndAsrAssets,
            &mut entries,
            |path| path.is_file() && has_extension(path, &["srt", "mp3", "vtt", "ass", "ssa"]),
            &[],
        )?;
    }

    collect_dir_files(&storage_paths::logs_dir(app)?, None, DataCategoryKey::Logs, &mut entries)?;
    collect_dir_files(&storage_paths::cache_dir(app)?, None, DataCategoryKey::AppCache, &mut entries)?;

    Ok(entries)
}

fn build_integrity_report(
    app: &AppHandle,
    db: &Database,
    notes: &[DataManagementNoteSummary],
    note_id_set: &HashSet<String>,
) -> Result<IntegrityReport, String> {
    let db_orphans = collect_db_orphan_operations(db, notes)?;
    let fs_orphans = collect_fs_orphan_operations(app, db, notes, note_id_set, true)?;
    let broken_assets = collect_broken_asset_operations(notes)?;

    let mut examples = Vec::new();
    examples.extend(collect_integrity_examples_from_operations(&db_orphans, 10));
    if examples.len() < 10 {
        examples.extend(collect_integrity_examples_from_operations(&fs_orphans, 10 - examples.len()));
    }
    if examples.len() < 10 {
        examples.extend(collect_integrity_examples_from_operations(&broken_assets, 10 - examples.len()));
    }

    Ok(IntegrityReport {
        db_orphans_count: db_orphans.len() as u64,
        fs_orphans_count: fs_orphans.len() as u64,
        broken_assets_count: broken_assets.len() as u64,
        examples,
    })
}

fn build_source_health_report(notes: &[DataManagementNoteSummary]) -> SourceHealthReport {
    let mut issues = Vec::new();
    let mut missing_video_count = 0u64;
    let mut missing_subtitle_count = 0u64;

    for note in notes {
        let video_path = Path::new(&note.video_path);
        if !video_path.exists() {
            missing_video_count += 1;
            issues.push(SourceHealthIssue {
                note_id: note.id.clone(),
                title: note.title.clone(),
                path: note.video_path.clone(),
                kind: "missing_video".to_string(),
            });
        }

        if let Some(subtitle_path) = &note.subtitle_path {
            if !subtitle_path.trim().is_empty() && !Path::new(subtitle_path).exists() {
                missing_subtitle_count += 1;
                issues.push(SourceHealthIssue {
                    note_id: note.id.clone(),
                    title: note.title.clone(),
                    path: subtitle_path.clone(),
                    kind: "missing_subtitle".to_string(),
                });
            }
        }
    }

    SourceHealthReport {
        missing_video_count,
        missing_subtitle_count,
        issues,
    }
}

fn collect_all_markers(db: &Database, notes: &[DataManagementNoteSummary]) -> Result<Vec<ScreenshotMarker>, String> {
    let mut markers = Vec::new();
    for note in notes {
        markers.extend(db.get_screenshot_markers(&note.id).map_err(|e| e.to_string())?);
    }
    Ok(markers)
}

fn collect_integrity_cleanup_operations(
    app: &AppHandle,
    db: &Database,
    notes: &[DataManagementNoteSummary],
    integrity_keys: &HashSet<IntegrityTargetKey>,
    include_global_orphans: bool,
) -> Result<Vec<CleanupOperation>, String> {
    let note_id_set: HashSet<String> = notes.iter().map(|note| note.id.clone()).collect();
    let mut operations = Vec::new();

    if integrity_keys.contains(&IntegrityTargetKey::DbOrphans) {
        operations.extend(collect_db_orphan_operations(db, notes)?);
    }
    if integrity_keys.contains(&IntegrityTargetKey::FsOrphans) {
        operations.extend(collect_fs_orphan_operations(app, db, notes, &note_id_set, include_global_orphans)?);
    }
    if integrity_keys.contains(&IntegrityTargetKey::BrokenAssets) {
        operations.extend(collect_broken_asset_operations(notes)?);
    }

    Ok(operations)
}

fn collect_db_orphan_operations(db: &Database, notes: &[DataManagementNoteSummary]) -> Result<Vec<CleanupOperation>, String> {
    let markers = collect_all_markers(db, notes)?;
    Ok(markers
        .into_iter()
        .filter(|marker| !Path::new(&marker.screenshot_path).exists())
        .map(|marker| CleanupOperation::DeleteMarker {
            note_id: marker.note_id,
            marker_id: marker.id,
            path: marker.screenshot_path,
        })
        .collect())
}

fn collect_fs_orphan_operations(
    app: &AppHandle,
    db: &Database,
    notes: &[DataManagementNoteSummary],
    note_id_set: &HashSet<String>,
    include_global_orphans: bool,
) -> Result<Vec<CleanupOperation>, String> {
    let mut operations = Vec::new();
    let markers = collect_all_markers(db, notes)?;
    let marker_paths: HashSet<String> = markers
        .iter()
        .map(|marker| normalize_path_string(&marker.screenshot_path))
        .collect();

    if include_global_orphans {
        let notes_root = storage_paths::notes_dir(app)?;
        if notes_root.exists() {
            for entry in fs::read_dir(&notes_root).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let note_id = entry.file_name().to_string_lossy().to_string();
                if !note_id_set.contains(&note_id) {
                    operations.push(CleanupOperation::DeletePath {
                        target_key: IntegrityTargetKey::FsOrphans.as_str().to_string(),
                        note_id: Some(note_id),
                        size_bytes: dir_size(&path)?,
                        path,
                    });
                }
            }
        }
    }

    for note in notes {
        let chapter_paths = collect_chapter_screenshot_paths(note);
        operations.extend(collect_orphan_file_operations(
            &storage_paths::chapter_screenshots_dir(app, &note.id)?,
            &chapter_paths,
            &note.id,
            IntegrityTargetKey::FsOrphans.as_str(),
        )?);

        let ai_note_paths = collect_ai_note_screenshot_paths(note);
        operations.extend(collect_orphan_file_operations(
            &storage_paths::ai_note_screenshots_dir(app, &note.id)?,
            &ai_note_paths,
            &note.id,
            IntegrityTargetKey::FsOrphans.as_str(),
        )?);

        operations.extend(collect_orphan_file_operations(
            &storage_paths::assist_screenshots_dir(app, &note.id)?,
            &marker_paths,
            &note.id,
            IntegrityTargetKey::FsOrphans.as_str(),
        )?);
    }

    Ok(operations)
}

fn collect_broken_asset_operations(notes: &[DataManagementNoteSummary]) -> Result<Vec<CleanupOperation>, String> {
    let mut operations = Vec::new();

    for note in notes {
        if let Some(updated_json) = remove_missing_chapter_screenshot_references(note)? {
            operations.push(CleanupOperation::UpdateDetailedReading {
                note_id: note.id.clone(),
                path: note.id.clone(),
                updated_json,
            });
        }

        if let Some(updated_markdown) = remove_missing_ai_note_asset_references(note) {
            operations.push(CleanupOperation::UpdateAiNoteMarkdown {
                note_id: note.id.clone(),
                path: note.id.clone(),
                updated_markdown,
            });
        }
    }

    Ok(operations)
}

fn collect_integrity_examples_from_operations(operations: &[CleanupOperation], limit: usize) -> Vec<IntegrityIssue> {
    operations
        .iter()
        .take(limit)
        .map(|operation| match operation {
            CleanupOperation::DeletePath { note_id, path, .. } => IntegrityIssue {
                note_id: note_id.clone(),
                path: path.to_string_lossy().to_string(),
                detail: if note_id.is_some() {
                    "文件存在，但无有效引用".to_string()
                } else {
                    "笔记目录存在，但数据库中无对应笔记".to_string()
                },
            },
            CleanupOperation::DeleteMarker { note_id, path, .. } => IntegrityIssue {
                note_id: Some(note_id.clone()),
                path: path.clone(),
                detail: "截图标记存在，但文件已缺失".to_string(),
            },
            CleanupOperation::UpdateDetailedReading { note_id, .. } => IntegrityIssue {
                note_id: Some(note_id.clone()),
                path: note_id.clone(),
                detail: "章节截图引用失效，可清理引用".to_string(),
            },
            CleanupOperation::UpdateAiNoteMarkdown { note_id, .. } => IntegrityIssue {
                note_id: Some(note_id.clone()),
                path: note_id.clone(),
                detail: "大纲笔记图片引用失效，可清理引用".to_string(),
            },
        })
        .collect()
}

fn collect_chapter_screenshot_paths(note: &DataManagementNoteSummary) -> HashSet<String> {
    let mut paths = HashSet::new();
    let Some(detailed_reading) = note.detailed_reading.as_deref() else {
        return paths;
    };

    if let Ok(parsed) = serde_json::from_str::<DetailedReadingData>(detailed_reading) {
        for chapter in parsed.chapters {
            if let Some(path) = chapter.screenshot_path {
                paths.insert(normalize_path_string(&path));
            }
        }
        return paths;
    }

    if let Ok(parsed) = serde_json::from_str::<ChapterData>(detailed_reading) {
        for chapter in parsed.chapters {
            if let Some(path) = chapter.screenshot_path {
                paths.insert(normalize_path_string(&path));
            }
        }
    }

    paths
}

fn collect_ai_note_screenshot_paths(note: &DataManagementNoteSummary) -> HashSet<String> {
    let mut paths = HashSet::new();
    let Some(markdown) = note.ai_note_markdown.as_deref() else {
        return paths;
    };

    for asset_path in extract_asset_local_paths(markdown) {
        paths.insert(normalize_path_string(&asset_path));
    }

    paths
}

fn remove_missing_chapter_screenshot_references(note: &DataManagementNoteSummary) -> Result<Option<String>, String> {
    let Some(detailed_reading) = note.detailed_reading.as_deref() else {
        return Ok(None);
    };

    if let Ok(mut parsed) = serde_json::from_str::<DetailedReadingData>(detailed_reading) {
        let mut changed = false;
        for chapter in &mut parsed.chapters {
            if let Some(path) = &chapter.screenshot_path {
                if !Path::new(path).exists() {
                    chapter.screenshot_path = None;
                    changed = true;
                }
            }
        }
        return if changed {
            serde_json::to_string(&parsed)
                .map(Some)
                .map_err(|e| format!("序列化原文细读失败: {}", e))
        } else {
            Ok(None)
        };
    }

    if let Ok(mut parsed) = serde_json::from_str::<ChapterData>(detailed_reading) {
        let mut changed = false;
        for chapter in &mut parsed.chapters {
            if let Some(path) = &chapter.screenshot_path {
                if !Path::new(path).exists() {
                    chapter.screenshot_path = None;
                    changed = true;
                }
            }
        }
        return if changed {
            serde_json::to_string(&parsed)
                .map(Some)
                .map_err(|e| format!("序列化章节数据失败: {}", e))
        } else {
            Ok(None)
        };
    }

    Ok(None)
}

fn remove_missing_ai_note_asset_references(note: &DataManagementNoteSummary) -> Option<String> {
    let markdown = note.ai_note_markdown.as_deref()?;
    let regex = Regex::new(r#"!?\[[^\]]*\]\((http://asset\.localhost/[^)\s]+)\)"#).ok()?;
    let mut changed = false;

    let updated = regex
        .replace_all(markdown, |caps: &regex::Captures| {
            let url = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
            let missing = url
                .strip_prefix("http://asset.localhost/")
                .and_then(|encoded| urlencoding::decode(encoded).ok())
                .map(|decoded| !Path::new(decoded.as_ref()).exists())
                .unwrap_or(false);
            if missing {
                changed = true;
                String::new()
            } else {
                caps.get(0).map(|m| m.as_str()).unwrap_or_default().to_string()
            }
        })
        .to_string();

    if changed {
        Some(updated.trim().to_string())
    } else {
        None
    }
}

fn extract_asset_local_paths(markdown: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut rest = markdown;

    while let Some(start) = rest.find("http://asset.localhost/") {
        let candidate = &rest[start..];
        let end = candidate
            .find(|ch: char| matches!(ch, ')' | '"' | '\'' | ' ' | '\n' | '\r' | '\t'))
            .unwrap_or(candidate.len());
        let url = &candidate[..end];
        if let Some(encoded) = url.strip_prefix("http://asset.localhost/") {
            if let Ok(decoded) = urlencoding::decode(encoded) {
                paths.push(decoded.into_owned());
            }
        }
        rest = &candidate[end..];
    }

    paths
}

fn collect_orphan_file_operations(
    dir: &Path,
    referenced_paths: &HashSet<String>,
    note_id: &str,
    target_key: &str,
) -> Result<Vec<CleanupOperation>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut operations = Vec::new();
    for file in walk_files(dir, &[])? {
        let normalized = normalize_path_string(&file.path.to_string_lossy());
        if !referenced_paths.contains(&normalized) {
            operations.push(CleanupOperation::DeletePath {
                target_key: target_key.to_string(),
                note_id: Some(note_id.to_string()),
                path: file.path,
                size_bytes: file.size_bytes,
            });
        }
    }

    Ok(operations)
}

fn build_cleanup_preview(operations: &[CleanupOperation]) -> CleanupPreview {
    let mut grouped: HashMap<String, Vec<&CleanupOperation>> = HashMap::new();
    let mut total_bytes = 0u64;
    let mut total_files = 0u64;
    let mut affected_note_ids = HashSet::new();

    for operation in operations {
        let key = cleanup_operation_group_key(operation);
        grouped.entry(key).or_default().push(operation);

        if let Some(size) = cleanup_operation_size(operation) {
            total_bytes += size;
        }
        if matches!(operation, CleanupOperation::DeletePath { .. }) {
            total_files += 1;
        }
        if let Some(note_id) = cleanup_operation_note_id(operation) {
            affected_note_ids.insert(note_id.to_string());
        }
    }

    let total_items = operations.len() as u64;
    let mut groups = grouped
        .into_iter()
        .map(|(key, items)| CleanupCandidateGroup {
            key: key.clone(),
            label: cleanup_group_label(&key).to_string(),
            reclaimable_bytes: items.iter().filter_map(|item| cleanup_operation_size(item)).sum(),
            items_count: items.len() as u64,
            sample_paths: items
                .iter()
                .take(5)
                .map(|item| cleanup_operation_path(item))
                .collect(),
            risk_level: risk_level_for_key(&key).to_string(),
            requires_confirmation: true,
        })
        .collect::<Vec<_>>();

    groups.sort_by(|a, b| a.label.cmp(&b.label));

    CleanupPreview {
        groups,
        total_bytes,
        total_files,
        total_items,
        affected_note_ids: sort_strings(affected_note_ids),
        warnings: Vec::new(),
    }
}

fn collect_dir_files(
    dir: &Path,
    note_id: Option<String>,
    category: DataCategoryKey,
    entries: &mut Vec<FileEntry>,
) -> Result<(), String> {
    for file in walk_files(dir, &[])? {
        entries.push(FileEntry {
            category,
            note_id: note_id.clone(),
            path: file.path,
            size_bytes: file.size_bytes,
        });
    }
    Ok(())
}

fn collect_matching_files<F>(
    dir: &Path,
    note_id: Option<String>,
    category: DataCategoryKey,
    entries: &mut Vec<FileEntry>,
    matcher: F,
    skip_dirs: &[&str],
) -> Result<(), String>
where
    F: Fn(&Path) -> bool,
{
    for file in walk_files(dir, skip_dirs)? {
        if matcher(&file.path) {
            entries.push(FileEntry {
                category,
                note_id: note_id.clone(),
                path: file.path,
                size_bytes: file.size_bytes,
            });
        }
    }
    Ok(())
}

#[derive(Debug)]
struct WalkedFile {
    path: PathBuf,
    size_bytes: u64,
}

fn walk_files(dir: &Path, skip_dirs: &[&str]) -> Result<Vec<WalkedFile>, String> {
    let mut files = Vec::new();
    if !dir.exists() {
        return Ok(files);
    }

    if dir.is_file() {
        let size_bytes = file_size(dir)?;
        files.push(WalkedFile {
            path: dir.to_path_buf(),
            size_bytes,
        });
        return Ok(files);
    }

    for entry in fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|item| item.to_str()).unwrap_or_default();
            if skip_dirs.contains(&name) {
                continue;
            }
            files.extend(walk_files(&path, skip_dirs)?);
        } else if path.is_file() {
            files.push(WalkedFile {
                size_bytes: file_size(&path)?,
                path,
            });
        }
    }

    Ok(files)
}

fn file_size(path: &Path) -> Result<u64, String> {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|e| format!("读取文件大小失败 {}: {}", path.display(), e))
}

fn dir_size(path: &Path) -> Result<u64, String> {
    Ok(walk_files(path, &[])?.into_iter().map(|file| file.size_bytes).sum())
}

fn cleanup_operation_group_key(operation: &CleanupOperation) -> String {
    match operation {
        CleanupOperation::DeletePath { target_key, .. } => target_key.clone(),
        CleanupOperation::DeleteMarker { .. } => IntegrityTargetKey::DbOrphans.as_str().to_string(),
        CleanupOperation::UpdateDetailedReading { .. } | CleanupOperation::UpdateAiNoteMarkdown { .. } => {
            IntegrityTargetKey::BrokenAssets.as_str().to_string()
        }
    }
}

fn cleanup_group_label(key: &str) -> &str {
    if let Some(category) = DataCategoryKey::from_key(key) {
        return category.label();
    }
    if let Some(target) = IntegrityTargetKey::from_key(key) {
        return target.label();
    }
    key
}

fn cleanup_operation_size(operation: &CleanupOperation) -> Option<u64> {
    match operation {
        CleanupOperation::DeletePath { size_bytes, .. } => Some(*size_bytes),
        _ => None,
    }
}

fn cleanup_operation_note_id(operation: &CleanupOperation) -> Option<&str> {
    match operation {
        CleanupOperation::DeletePath { note_id, .. } => note_id.as_deref(),
        CleanupOperation::DeleteMarker { note_id, .. }
        | CleanupOperation::UpdateDetailedReading { note_id, .. }
        | CleanupOperation::UpdateAiNoteMarkdown { note_id, .. } => Some(note_id.as_str()),
    }
}

fn cleanup_operation_path(operation: &CleanupOperation) -> String {
    match operation {
        CleanupOperation::DeletePath { path, .. } => path.to_string_lossy().to_string(),
        CleanupOperation::DeleteMarker { path, .. }
        | CleanupOperation::UpdateDetailedReading { path, .. }
        | CleanupOperation::UpdateAiNoteMarkdown { path, .. } => path.clone(),
    }
}

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| extensions.iter().any(|expected| ext.eq_ignore_ascii_case(expected)))
        .unwrap_or(false)
}

fn normalize_path_string(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn sort_strings<T: Into<String>>(items: impl IntoIterator<Item = T>) -> Vec<String> {
    let mut values = items.into_iter().map(Into::into).collect::<Vec<_>>();
    values.sort();
    values
}

fn risk_level_for_key(key: &str) -> &'static str {
    match key {
        "logs" | "app_cache" | "video_mp4_cache" | "db_orphans" => "low",
        "chapter_screenshots" | "ai_note_screenshots" | "assist_screenshots" | "fs_orphans" => "medium",
        "generated_subtitles_and_asr_assets" | "broken_assets" => "medium",
        _ => "medium",
    }
}
