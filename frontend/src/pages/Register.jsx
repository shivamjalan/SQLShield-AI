import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { register as registerRequest, login as loginRequest } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import { Input } from "../components/ui/Input";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await registerRequest(email, password);
      // Registration only returns the created user, not tokens -- log in
      // immediately after so a new account lands straight on the
      // dashboard instead of a second manual sign-in step.
      const data = await loginRequest(email, password);
      login(data);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-[60%_40%_30%_70%/60%_30%_70%_40%] bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-secondary/20 blur-3xl" />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-[2.5rem_2.5rem_2.5rem_1rem] border border-border/50 bg-card p-9 shadow-float"
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft">
            <ShieldCheck size={26} strokeWidth={2.25} />
          </span>
          <h1 className="font-heading text-3xl font-bold text-foreground">SQLShield AI</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Create your account</p>
        </div>

        {error && (
          <div className="mb-5 rounded-[1.25rem] border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        <label className="mb-1.5 block px-1 text-sm font-bold text-foreground">Email</label>
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4"
        />

        <label className="mb-1.5 block px-1 text-sm font-bold text-foreground">Password</label>
        <Input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-2"
        />
        <p className="mb-7 px-1 text-xs text-muted-foreground">
          New accounts always start as <code className="font-mono">intern</code> — an admin can
          promote you afterward.
        </p>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Creating account..." : "Create account"}
        </Button>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-bold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
