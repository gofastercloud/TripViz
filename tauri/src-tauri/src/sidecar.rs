use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 8000;
pub const MAX_PORT: u16 = 8010;
pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
pub const HEALTH_BACKOFF_START: Duration = Duration::from_millis(100);
pub const HEALTH_BACKOFF_CAP: Duration = Duration::from_millis(2000);

#[derive(Debug)]
pub enum SidecarError {
    BinaryNotFound(PathBuf),
    SpawnFailed(std::io::Error),
    HealthTimeout,
}

impl std::fmt::Display for SidecarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BinaryNotFound(p) => write!(f, "backend binary not found at {:?}", p),
            Self::SpawnFailed(e) => write!(f, "failed to spawn backend: {}", e),
            Self::HealthTimeout => write!(f, "backend did not become healthy in time"),
        }
    }
}

impl std::error::Error for SidecarError {}

/// Find the first free TCP port in [start, max] by binding & releasing.
pub fn find_free_port(start: u16, max: u16) -> Option<u16> {
    for port in start..=max {
        if TcpListener::bind((DEFAULT_HOST, port)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// Compute next exponential backoff delay, capped.
pub fn next_backoff(current: Duration, cap: Duration) -> Duration {
    let doubled = current.saturating_mul(2);
    if doubled > cap {
        cap
    } else {
        doubled
    }
}

/// Poll a URL until it returns HTTP 200 or timeout elapses.
/// Returns Ok(()) on success.
pub fn wait_for_health<F>(check: F, total_timeout: Duration) -> Result<(), SidecarError>
where
    F: Fn() -> bool,
{
    let start = Instant::now();
    let mut delay = HEALTH_BACKOFF_START;
    while start.elapsed() < total_timeout {
        if check() {
            return Ok(());
        }
        thread::sleep(delay);
        delay = next_backoff(delay, HEALTH_BACKOFF_CAP);
    }
    Err(SidecarError::HealthTimeout)
}

/// HTTP health probe against GET http://host:port/api/health.
pub fn http_health_check(host: &str, port: u16) -> bool {
    let url = format!("http://{}:{}/api/health", host, port);
    match ureq::get(&url).timeout(Duration::from_millis(500)).call() {
        Ok(resp) => resp.status() == 200,
        Err(_) => false,
    }
}

/// Resolve per-user application data directory.
/// Windows: %LOCALAPPDATA%\TripViz
/// macOS: ~/Library/Application Support/TripViz
/// Linux: ~/.local/share/TripViz
pub fn resolve_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    let base = dirs::data_local_dir();
    #[cfg(not(target_os = "windows"))]
    let base = dirs::data_dir();
    base.unwrap_or_else(|| PathBuf::from(".")).join("TripViz")
}

/// Resolve the bundled sidecar binary path. In dev, Tauri expects a target-triple
/// suffixed binary under `src-tauri/binaries/`. In a bundled build it lives next
/// to the main executable. We try several locations.
pub fn resolve_sidecar_binary(src_tauri_dir: &Path, bin_name: &str) -> Option<PathBuf> {
    let ext = if cfg!(windows) { ".exe" } else { "" };

    // Candidate 1: alongside the running executable (bundled build).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p = parent.join(format!("{}{}", bin_name, ext));
            if p.exists() {
                return Some(p);
            }
        }
    }

    // Candidate 2: src-tauri/binaries/<name>[.exe] (dev stub).
    let stub = src_tauri_dir
        .join("binaries")
        .join(format!("{}{}", bin_name, ext));
    if stub.exists() {
        return Some(stub);
    }

    // Candidate 3: src-tauri/binaries/<name>-<triple>[.exe] — scan for any.
    let bin_dir = src_tauri_dir.join("binaries");
    if let Ok(entries) = std::fs::read_dir(&bin_dir) {
        for e in entries.flatten() {
            let name = e.file_name();
            let name_s = name.to_string_lossy();
            if name_s.starts_with(bin_name) {
                return Some(e.path());
            }
        }
    }

    None
}

pub struct SidecarHandle {
    child: Arc<Mutex<Option<Child>>>,
    pub port: u16,
}

impl SidecarHandle {
    pub fn spawn(
        binary: &Path,
        data_dir: &Path,
        host: &str,
        port: u16,
        log_file: &Path,
    ) -> Result<Self, SidecarError> {
        if !binary.exists() {
            return Err(SidecarError::BinaryNotFound(binary.to_path_buf()));
        }
        std::fs::create_dir_all(data_dir).ok();

        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_file)
            .map_err(SidecarError::SpawnFailed)?;
        let log_err = log.try_clone().map_err(SidecarError::SpawnFailed)?;

        let mut cmd = Command::new(binary);
        cmd.env("TRIPVIZ_API_ONLY", "1")
            .env("TRIPVIZ_DATA_DIR", data_dir)
            .env("TRIPVIZ_HOST", host)
            .env("TRIPVIZ_PORT", port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW so the sidecar doesn't flash a console.
            cmd.creation_flags(0x0800_0000);
        }

        let mut child = cmd.spawn().map_err(SidecarError::SpawnFailed)?;

        // Tee stdout/stderr into log file on background threads.
        if let Some(out) = child.stdout.take() {
            let mut log = log;
            thread::spawn(move || {
                let reader = BufReader::new(out);
                for line in reader.lines().flatten() {
                    let _ = writeln!(log, "[stdout] {}", line);
                }
            });
        }
        if let Some(err) = child.stderr.take() {
            let mut log = log_err;
            thread::spawn(move || {
                let reader = BufReader::new(err);
                for line in reader.lines().flatten() {
                    let _ = writeln!(log, "[stderr] {}", line);
                }
            });
        }

        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
            port,
        })
    }

    pub fn shutdown(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            #[cfg(unix)]
            {
                unsafe {
                    libc_kill(child.id() as i32, 15);
                }
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => return,
                        Ok(None) => {
                            if Instant::now() >= deadline {
                                let _ = child.kill();
                                let _ = child.wait();
                                return;
                            }
                            thread::sleep(Duration::from_millis(50));
                        }
                        Err(_) => {
                            let _ = child.kill();
                            return;
                        }
                    }
                }
            }
            #[cfg(not(unix))]
            {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

#[cfg(unix)]
#[allow(non_snake_case)]
unsafe fn libc_kill(pid: i32, sig: i32) -> i32 {
    kill(pid, sig)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc as StdArc;

    #[test]
    fn backoff_doubles_until_cap() {
        let d = Duration::from_millis(100);
        let d = next_backoff(d, Duration::from_millis(2000));
        assert_eq!(d, Duration::from_millis(200));
        let d = next_backoff(d, Duration::from_millis(2000));
        assert_eq!(d, Duration::from_millis(400));
        let d = next_backoff(d, Duration::from_millis(2000));
        assert_eq!(d, Duration::from_millis(800));
        let d = next_backoff(d, Duration::from_millis(2000));
        assert_eq!(d, Duration::from_millis(1600));
        let d = next_backoff(d, Duration::from_millis(2000));
        assert_eq!(d, Duration::from_millis(2000));
        let d = next_backoff(d, Duration::from_millis(2000));
        assert_eq!(d, Duration::from_millis(2000));
    }

    #[test]
    fn find_free_port_returns_some_in_range() {
        // Port 0 trick isn't used; use a high range unlikely to be busy.
        let p = find_free_port(49000, 49010);
        assert!(p.is_some());
        let p = p.unwrap();
        assert!((49000..=49010).contains(&p));
    }

    #[test]
    fn find_free_port_skips_occupied() {
        let listener = TcpListener::bind((DEFAULT_HOST, 0)).unwrap();
        let occupied = listener.local_addr().unwrap().port();
        // Search a range that includes the occupied port; we should get a different port.
        let p = find_free_port(occupied, occupied + 5);
        assert!(p.is_some());
        assert_ne!(p.unwrap(), occupied);
        drop(listener);
    }

    #[test]
    fn wait_for_health_succeeds_when_check_eventually_true() {
        let counter = StdArc::new(AtomicUsize::new(0));
        let c = counter.clone();
        let result = wait_for_health(
            move || {
                let n = c.fetch_add(1, Ordering::SeqCst);
                n >= 3
            },
            Duration::from_secs(2),
        );
        assert!(result.is_ok());
        assert!(counter.load(Ordering::SeqCst) >= 4);
    }

    #[test]
    fn wait_for_health_times_out() {
        let result = wait_for_health(|| false, Duration::from_millis(250));
        assert!(matches!(result, Err(SidecarError::HealthTimeout)));
    }

    #[test]
    fn data_dir_resolves_under_tripviz() {
        let d = resolve_data_dir();
        assert!(d.ends_with("TripViz"));
    }

    #[test]
    fn resolve_sidecar_binary_finds_stub() {
        let here = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let bin = resolve_sidecar_binary(&here, "tripviz-backend");
        assert!(bin.is_some(), "expected to find a stub under binaries/");
        assert!(bin.unwrap().exists());
    }

    /// End-to-end smoke test against the shell stub. Spawns the stub backend,
    /// polls /api/health, then shuts it down and verifies it's gone.
    #[test]
    fn end_to_end_spawn_health_shutdown() {
        let here = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let bin = resolve_sidecar_binary(&here, "tripviz-backend")
            .expect("stub binary present");
        let tmp = std::env::temp_dir().join("tripviz-sidecar-test");
        std::fs::create_dir_all(&tmp).unwrap();
        let log = tmp.join("sidecar.log");

        let port = find_free_port(48000, 48020).expect("free port");
        let handle = SidecarHandle::spawn(&bin, &tmp, DEFAULT_HOST, port, &log)
            .expect("spawn stub backend");

        let ok = wait_for_health(
            || http_health_check(DEFAULT_HOST, port),
            Duration::from_secs(10),
        );
        assert!(ok.is_ok(), "stub backend should become healthy");

        handle.shutdown();
        // After shutdown the port should be free again shortly.
        thread::sleep(Duration::from_millis(200));
        let free = TcpListener::bind((DEFAULT_HOST, port)).is_ok();
        assert!(free, "port should be released after shutdown");
    }
}
