export function AgentsPage() {
  return (
    <div className="card">
      <h1>AI Agent Runtimes</h1>
      <ul>
        <li>OpenClaw</li>
        <li>Hermes</li>
        <li>IonClaw</li>
      </ul>
      <p className="muted">All agent tool calls pass Allowlist + Approval gates.</p>
    </div>
  );
}
