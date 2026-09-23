/** Saving generated files and reading files the user picks. */

/**
 * Offers a file for download.
 * @param {Uint8Array|string} content
 * @param {string} fileName
 * @param {string} mimeType
 */
export function download(content, fileName, mimeType) {
  const blob = content instanceof Uint8Array
    ? new Blob([content], { type: mimeType })
    : new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads a picked file as text (for CSV). */
export function readAsText(file) {
  return file.text();
}

/** Reads a picked file as bytes (for XLSX). */
export async function readAsBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export const MIME = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  json: 'application/json',
};
