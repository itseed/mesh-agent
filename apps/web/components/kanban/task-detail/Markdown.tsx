import type { ReactNode } from 'react';

function renderInlineParts(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      parts.push(
        <strong key={k++} className="font-semibold text-text">
          {m[1]}
        </strong>,
      );
    } else if (m[2]) {
      parts.push(
        <code
          key={k++}
          className="bg-black/20 text-green-400/70 font-mono text-[12px] px-1 py-0.5 rounded"
        >
          {m[2]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ body }: { body: string }) {
  const segments = body.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3).replace(/^[^\n]*\n?/, '');
          return (
            <pre
              key={i}
              className="bg-black/30 text-green-400/80 font-mono text-[11px] p-3 rounded overflow-auto max-h-64 my-1.5 whitespace-pre-wrap break-all"
            >
              {inner}
            </pre>
          );
        }
        return (
          <span key={i}>
            {seg.split('\n').map((line, j) =>
              line.trim() === '' ? (
                <br key={j} />
              ) : (
                <p key={j} className="text-[13px] text-text leading-relaxed my-0.5">
                  {renderInlineParts(line)}
                </p>
              ),
            )}
          </span>
        );
      })}
    </>
  );
}
