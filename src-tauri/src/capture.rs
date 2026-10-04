// Native screen/window capture via xcap (Windows Graphics Capture / BitBlt).
// Replaces the WebView2 getDisplayMedia prompt with a proper source picker:
// no permission dialog, no window-switching friction.

use serde::Serialize;
use xcap::{Monitor, Window};

#[derive(Serialize)]
pub struct CaptureSource {
    pub kind: &'static str, // "monitor" | "window"
    pub id: usize,
    pub label: String,
    #[serde(rename = "appName")]
    pub app_name: Option<String>,
}

#[tauri::command]
pub fn capture_sources() -> Vec<CaptureSource> {
    let mut out = Vec::new();
    if let Ok(monitors) = Monitor::all() {
        for (i, m) in monitors.iter().enumerate() {
            out.push(CaptureSource {
                kind: "monitor",
                id: i,
                label: format!(
                    "Display {} — {}×{}",
                    i + 1,
                    m.width().unwrap_or(0),
                    m.height().unwrap_or(0)
                ),
                app_name: None,
            });
        }
    }
    if let Ok(windows) = Window::all() {
        let mut i = 0;
        for w in windows.iter() {
            if w.is_minimized().unwrap_or(false) {
                continue;
            }
            let title = w.title().unwrap_or_default();
            if title.trim().is_empty() {
                continue;
            }
            i += 1;
            out.push(CaptureSource {
                kind: "window",
                id: i - 1,
                label: title,
                app_name: w.app_name().ok(),
            });
        }
    }
    out
}

fn encode_jpeg(image: image::RgbaImage, max_w: u32, quality: u8) -> Result<String, String> {
    use base64::Engine;
    let mut w = image.width();
    let mut h = image.height();
    if w > max_w {
        h = h * max_w / w;
        w = max_w;
    }
    let resized = if w != image.width() {
        image::imageops::resize(&image, w, h, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let rgb = image::DynamicImage::ImageRgba8(resized).to_rgb8();
    let mut buf = std::io::Cursor::new(Vec::new());
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    enc.encode_image(&rgb).map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(buf.get_ref())
    ))
}

#[tauri::command]
pub fn capture_screen(
    kind: String,
    id: usize,
    max_width: Option<u32>,
    quality: Option<u8>,
) -> Result<String, String> {
    let max_w = max_width.unwrap_or(1600).min(2560);
    let q = quality.unwrap_or(80).clamp(30, 92);
    match kind.as_str() {
        "monitor" => {
            let monitors = Monitor::all().map_err(|e| e.to_string())?;
            let m = monitors.get(id).ok_or("No such display")?;
            let img = m.capture_image().map_err(|e| e.to_string())?;
            encode_jpeg(img, max_w, q)
        }
        "window" => {
            let windows = Window::all().map_err(|e| e.to_string())?;
            // Same filter as capture_sources — index aligns with the picker.
            let visible: Vec<_> = windows
                .iter()
                .filter(|w| !w.is_minimized().unwrap_or(false))
                .filter(|w| !w.title().unwrap_or_default().trim().is_empty())
                .collect();
            let w = visible.get(id).ok_or("No such window")?;
            let img = w.capture_image().map_err(|e| e.to_string())?;
            encode_jpeg(img, max_w, q)
        }
        _ => Err("kind must be 'monitor' or 'window'".into()),
    }
}
