export function TipsCard() {
  return (
    <div className="tips-card">
      <h4>Shortcuts</h4>
      <ul>
        <li>
          <span>Paste image</span>
          <kbd>Ctrl V</kbd>
        </li>
        <li>
          <span>Drop image files</span>
          <kbd>Drag</kbd>
        </li>
        <li>
          <span>Commit edit</span>
          <kbd>Enter</kbd>
        </li>
        <li>
          <span>Cancel edit</span>
          <kbd>Esc</kbd>
        </li>
      </ul>
    </div>
  );
}
