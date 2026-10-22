import { Link } from 'react-router';
import { Empty } from '../components/States';

export function NotFoundPage() {
  return (
    <div className="page">
      <Empty title="Страница не найдена">
        <p>Возможно, трек удалён или ссылка неверна.</p>
        <Link to="/" className="btn btn-primary">
          На главную
        </Link>
      </Empty>
    </div>
  );
}
