use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PdfError {
    #[error("PDF extraction failed: {0}")]
    Extract(String),
    #[error("PDF conversion failed: {0}")]
    Convert(String),
}

pub fn extract_text(path: &Path) -> Result<String, PdfError> {
    pdf_extract::extract_text(path).map_err(|e| PdfError::Extract(e.to_string()))
}

pub fn convert_docx_to_pdf(docx_path: &Path, pdf_path: &Path) -> Result<(), PdfError> {
    if let Ok(()) = convert_via_word_com(docx_path, pdf_path) {
        return Ok(());
    }

    convert_via_libreoffice(docx_path, pdf_path)
}

pub fn convert_via_word_only(docx_path: &Path, pdf_path: &Path) -> Result<(), PdfError> {
    convert_via_word_com(docx_path, pdf_path)
}

pub fn convert_via_libreoffice_only(docx_path: &Path, pdf_path: &Path) -> Result<(), PdfError> {
    convert_via_libreoffice(docx_path, pdf_path)
}

#[cfg(windows)]
fn convert_via_word_com(docx_path: &Path, pdf_path: &Path) -> Result<(), PdfError> {
    let docx = docx_path
        .canonicalize()
        .map_err(|e| PdfError::Convert(e.to_string()))?;
    let pdf = pdf_path
        .canonicalize()
        .map_err(|e| PdfError::Convert(e.to_string()))?;

    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {{
    $doc = $word.Documents.Open('{docx}')
    $wdFormatPDF = 17
    $doc.SaveAs([ref]'{pdf}', [ref]$wdFormatPDF)
    $doc.Close()
}} finally {{
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}}
"#,
        docx = docx.to_string_lossy().replace('\'', "''"),
        pdf = pdf.to_string_lossy().replace('\'', "''"),
    );

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|e| PdfError::Convert(format!("Word COM failed to start: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PdfError::Convert(format!("Word COM error: {stderr}")));
    }

    if !pdf_path.exists() {
        return Err(PdfError::Convert(
            "Word COM completed but PDF was not created".into(),
        ));
    }

    Ok(())
}

#[cfg(not(windows))]
fn convert_via_word_com(_docx_path: &Path, _pdf_path: &Path) -> Result<(), PdfError> {
    Err(PdfError::Convert("Word COM is only available on Windows".into()))
}

fn convert_via_libreoffice(docx_path: &Path, pdf_path: &Path) -> Result<(), PdfError> {
    let out_dir = pdf_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    let soffice = find_libreoffice().ok_or_else(|| {
        PdfError::Convert(
            "LibreOffice not found. Install LibreOffice or use Microsoft Word on Windows.".into(),
        )
    })?;

    let output = Command::new(&soffice)
        .args([
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            &out_dir.to_string_lossy(),
            &docx_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| PdfError::Convert(format!("LibreOffice failed to start: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PdfError::Convert(format!("LibreOffice error: {stderr}")));
    }

    let expected = out_dir.join(
        docx_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .as_ref(),
    ).with_extension("pdf");

    if expected != pdf_path && expected.exists() {
        std::fs::rename(&expected, pdf_path)
            .map_err(|e| PdfError::Convert(format!("Failed to move PDF: {e}")))?;
    }

    if !pdf_path.exists() {
        return Err(PdfError::Convert(
            "LibreOffice completed but PDF was not created".into(),
        ));
    }

    Ok(())
}

fn find_libreoffice() -> Option<PathBuf> {
    let candidates = if cfg!(windows) {
        vec![
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ]
    } else {
        vec!["/usr/bin/libreoffice", "/usr/bin/soffice"]
    };

    for c in candidates {
        let path = PathBuf::from(c);
        if path.exists() {
            return Some(path);
        }
    }

    which_soffice()
}

fn which_soffice() -> Option<PathBuf> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let output = Command::new(cmd).arg("soffice").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}
