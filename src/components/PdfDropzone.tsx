type Props = {
  busy: boolean
  onFile: (file: File) => void
}

export function PdfDropzone({ busy, onFile }: Props) {
  const handle = (files: FileList | null) => {
    const f = files?.[0]
    if (f && f.type === 'application/pdf') onFile(f)
  }

  return (
    <div
      className={`rounded-lg border border-dashed border-lab-border bg-lab-surface px-4 py-6 text-center shadow-card transition-colors ${
        busy ? 'opacity-60' : 'hover:border-lab-accent/50 hover:bg-lab-accentSoft/40'
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        handle(e.dataTransfer.files)
      }}
    >
      <input
        id="pdf-input"
        type="file"
        accept="application/pdf"
        className="hidden"
        disabled={busy}
        onChange={(e) => handle(e.target.files)}
      />
      <label htmlFor="pdf-input" className="cursor-pointer text-sm text-lab-muted">
        <span className="font-medium text-lab-ink">Drop CAS PDF</span>
        <span className="block mt-1">or tap to browse — Section 3 &amp; 5 text-based statement</span>
      </label>
    </div>
  )
}
