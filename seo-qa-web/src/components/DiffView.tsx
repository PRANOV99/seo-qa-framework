import type { DiffSegment } from '../lib/api';

interface Props {
  segments: DiffSegment[];
}

/** Renders a word-level diff inline — unchanged words plain, removed words struck through in red, added/changed words highlighted in green. */
export default function DiffView({ segments }: Props) {
  return (
    <div className="diff-view">
      {segments.map((seg, i) => {
        if (seg.type === 'same') {
          return <span key={i}>{seg.expected} </span>;
        }
        if (seg.type === 'removed') {
          return <span key={i} className="diff-removed">{seg.expected} </span>;
        }
        if (seg.type === 'added') {
          return <span key={i} className="diff-added">{seg.actual} </span>;
        }
        // changed
        return (
          <span key={i}>
            <span className="diff-removed">{seg.expected}</span>{' '}
            <span className="diff-added">{seg.actual}</span>{' '}
          </span>
        );
      })}
    </div>
  );
}
