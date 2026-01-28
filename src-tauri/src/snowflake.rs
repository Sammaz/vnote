//! Snowflake ID Generator
//!
//! Generates unique 64-bit IDs using a modified Snowflake algorithm.
//! IDs are returned as strings to avoid JavaScript precision loss.

use std::sync::atomic::{AtomicI64, AtomicU16, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Custom epoch: 2024-01-01 00:00:00 UTC (milliseconds since Unix epoch)
const CUSTOM_EPOCH: i64 = 1704067200000;

/// Number of bits for sequence number (12 bits = 4096 IDs per millisecond)
const SEQUENCE_BITS: u8 = 12;

/// Number of bits for machine ID (10 bits = 1024 machines)
const MACHINE_ID_BITS: u8 = 10;

/// Mask for sequence number
const SEQUENCE_MASK: u16 = (1 << SEQUENCE_BITS) - 1;

/// Snowflake ID generator
pub struct SnowflakeGenerator {
    /// Machine ID (0-1023)
    machine_id: u16,
    /// Last timestamp used
    last_timestamp: AtomicI64,
    /// Sequence number within the same millisecond
    sequence: AtomicU16,
}

impl SnowflakeGenerator {
    /// Create a new Snowflake generator with the given machine ID
    pub fn new(machine_id: u16) -> Self {
        Self {
            machine_id: machine_id & ((1 << MACHINE_ID_BITS) - 1),
            last_timestamp: AtomicI64::new(0),
            sequence: AtomicU16::new(0),
        }
    }

    /// Generate a new unique ID
    pub fn generate(&self) -> i64 {
        let mut timestamp = self.current_timestamp();
        let last_ts = self.last_timestamp.load(Ordering::SeqCst);

        if timestamp == last_ts {
            // Same millisecond, increment sequence
            let seq = self.sequence.fetch_add(1, Ordering::SeqCst) & SEQUENCE_MASK;
            if seq == 0 {
                // Sequence overflow, wait for next millisecond
                timestamp = self.wait_next_millis(last_ts);
            }
        } else if timestamp < last_ts {
            // Clock moved backwards, wait for last timestamp
            timestamp = self.wait_next_millis(last_ts);
        } else {
            // New millisecond, reset sequence
            self.sequence.store(0, Ordering::SeqCst);
        }

        self.last_timestamp.store(timestamp, Ordering::SeqCst);
        let seq = self.sequence.load(Ordering::SeqCst);

        // Compose the ID:
        // | 41 bits timestamp | 10 bits machine_id | 12 bits sequence |
        ((timestamp - CUSTOM_EPOCH) << (MACHINE_ID_BITS + SEQUENCE_BITS))
            | ((self.machine_id as i64) << SEQUENCE_BITS)
            | (seq as i64)
    }

    /// Get current timestamp in milliseconds
    fn current_timestamp(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_millis() as i64
    }

    /// Wait until the next millisecond
    fn wait_next_millis(&self, last_ts: i64) -> i64 {
        let mut timestamp = self.current_timestamp();
        while timestamp <= last_ts {
            std::hint::spin_loop();
            timestamp = self.current_timestamp();
        }
        timestamp
    }
}

/// Global Snowflake generator instance
static SNOWFLAKE: OnceLock<SnowflakeGenerator> = OnceLock::new();

/// Get or initialize the global Snowflake generator
fn get_generator() -> &'static SnowflakeGenerator {
    SNOWFLAKE.get_or_init(|| {
        // Use a random machine ID for single-instance desktop app
        let machine_id = std::process::id() as u16 & ((1 << MACHINE_ID_BITS) - 1);
        SnowflakeGenerator::new(machine_id)
    })
}

/// Generate a new Snowflake ID (i64)
pub fn generate_id() -> i64 {
    get_generator().generate()
}

/// Generate a new Snowflake ID as string (for frontend transmission)
pub fn generate_id_string() -> String {
    generate_id().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_unique_ids() {
        let mut ids = HashSet::new();
        for _ in 0..10000 {
            let id = generate_id();
            assert!(ids.insert(id), "Duplicate ID generated: {}", id);
        }
    }

    #[test]
    fn test_id_string() {
        let id_str = generate_id_string();
        assert!(!id_str.is_empty());
        assert!(id_str.parse::<i64>().is_ok());
    }

    #[test]
    fn test_id_ordering() {
        let id1 = generate_id();
        std::thread::sleep(std::time::Duration::from_millis(1));
        let id2 = generate_id();
        assert!(id2 > id1, "IDs should be monotonically increasing");
    }
}
