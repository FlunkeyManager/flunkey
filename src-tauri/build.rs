fn main() {
    println!("cargo:rerun-if-changed=icons/taskbar.ico");
    tauri_build::build()
}
