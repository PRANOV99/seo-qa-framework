import { useRef, useState, useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';

interface Props {
  /** Single-file mode (default): fired once with the first picked/dropped file. */
  onFile?: (f: File) => void;
  /** Multi-file mode: fired with every picked/dropped file. Requires `multiple`. */
  onFiles?: (files: File[]) => void;
  /** Allows picking/dropping more than one file at once. Defaults to false (unchanged single-file behavior). */
  multiple?: boolean;
  accept?: string;
  hint?: string;
}

export default function DropZone({ onFile, onFiles, multiple = false, accept = '.xlsx,.csv,.docx', hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState('');

  function pick(files: File[]) {
    if (files.length === 0) return;
    if (multiple) {
      onFiles?.(files);
    } else {
      setFilename(files[0]!.name);
      onFile?.(files[0]!);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    pick([...e.dataTransfer.files]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiple]);

  return (
    <div
      className={`upload-zone ${dragging ? 'drag-over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
    >
      <input
        ref={inputRef} type="file" accept={accept} multiple={multiple} hidden
        onChange={e => {
          pick([...(e.target.files ?? [])]);
          e.target.value = ''; // allow re-picking the same file(s) again
        }}
      />
      <div className="upload-icon">
        {!multiple && filename ? <FileText size={40} style={{ color: 'var(--success)' }} /> : <Upload size={40} style={{ color: 'var(--text-muted)' }} />}
      </div>
      {!multiple && filename ? (
        <>
          <div style={{ fontWeight: 600, fontSize: 15 }}>File selected</div>
          <div className="upload-filename">{filename}</div>
          <div className="upload-hint" style={{ marginTop: 8 }}>Click to change file</div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            Drag & drop or <span style={{ color: 'var(--primary)' }}>browse</span>
          </div>
          <div className="upload-hint">{hint ?? 'Supported: .xlsx, .csv, .docx — up to 50 MB'}</div>
        </>
      )}
    </div>
  );
}
