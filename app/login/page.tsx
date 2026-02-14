import { signIn, signUp } from "@/lib/actions/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className="login-page">
      <div className="card card-pad login-card">
        <h1 className="login-title">Sign in to Orchestrator</h1>

        {error && <div className="notice">{error}</div>}
        {message && <div className="notice" style={{ borderColor: "#ade3cf", background: "#eefbf5", color: "var(--brand)" }}>{message}</div>}

        <form className="stack">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required minLength={6} />
          </div>
          <div className="login-actions">
            <button formAction={signIn} className="btn btn-primary">
              Sign in
            </button>
            <button formAction={signUp} className="btn">
              Sign up
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
