import { useRef, useState, useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';

interface Props {
  onFile: (f: File) => void;
  accept?: string;
}

export default function DropZone({ onFile, accept = '.xlsx,.csv,.docx' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState('');

  function pick(file: File) {
    setFilename(file.name);
    onFile(file);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) pick(file);
  }, []);

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
        ref={inputRef} type="file" accept={accept} hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); }}
      />
      <div className="upload-icon">
        {filename ? <FileText size={40} style={{ color: 'var(--success)' }} /> : <Upload size={40} style={{ color: 'var(--text-muted)' }} />}
      </div>
      {filename ? (
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
          <div className="upload-hint">Supported: .xlsx, .csv, .docx — up to 50 MB</div>
        </>
      )}
    </div>
  );
}
