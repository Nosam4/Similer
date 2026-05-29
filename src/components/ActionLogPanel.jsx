function ActionLogPanel({ log }) {
  return (
    <section className="log-panel">
      <h3>Action Log</h3>
      <ol>
        {[...log].reverse().map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ol>
    </section>
  )
}

export default ActionLogPanel
