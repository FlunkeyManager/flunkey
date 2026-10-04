// Prevents additional console window on Windows in release, do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Configure WebView2 arguments before Tauri initializes:
    // 1. CalculateNativeWinOcclusion & IntensiveWakeUpThrottling disabled:
    //    Prevents WebView2 from suspending / freezing DirectComposition rendering
    //    when other applications (e.g. WhatsApp, fullscreen apps) overlap or close.
    // 2. backgrounding-occluded-windows disabled:
    //    Ensures the floating transparent pill maintains live frame rendering.
    // 3. autoplay-policy=no-user-gesture-required:
    //    Allows immediate audio playback and background processing on hotkey press
    //    without requiring a prior manual mouse click into the webview.
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required",
    );

    flunkey_lib::run()
}

