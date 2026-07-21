// HistoryDetail renders a single historical audit record.
// It reuses the Results page component directly with the history record id.
import { useParams } from 'react-router-dom';
import Results from './Results';

// The Results page already reads from /api/runs/:id which falls through to
// the history store, so we can just render it with the same id param.
export default function HistoryDetail() {
  const { id } = useParams<{ id: string }>();
  // Results reads `id` from its own useParams — same route param works fine.
  void id;
  return <Results />;
}
