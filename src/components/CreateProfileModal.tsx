import { Link } from "react-router-dom";

interface CreateProfileModalProps {
  onClose: () => void;
}

export function CreateProfileModal({ onClose }: CreateProfileModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Create a profile first</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <p>
            Profiles store your base resume. Select or create a profile before
            starting a session.
          </p>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <Link to="/profiles" className="btn-primary gpt-link-btn">
            Go to Profiles
          </Link>
        </footer>
      </div>
    </div>
  );
}
