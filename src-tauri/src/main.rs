// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(e) = puremark_lib::run() {
        eprintln!("fatal: {e:?}");
        std::process::exit(1);
    }
}
